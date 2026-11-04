import { Prisma, SeatStatus } from '@prisma/client';
import { MAX_SEATS_PER_EVENT, PRICING_TIERS, isCinemaVenueType } from '@repo/shared';
import type { CreateEventInput, UpdateEventInput } from '@repo/shared';
import { prisma } from '../db';
import { AppError } from '../errors';
import { getVenueTemplate } from './venueTemplates.service';
import {
  ExistingSeat,
  buildSeatPlan,
  planExtension,
  planShrink,
  refreshLayoutMeta,
} from './seatLayout.service';

type Tx = Prisma.TransactionClient;

export interface SeatState {
  id: string; // EventSeat id
  showId?: string | null;
  status: SeatStatus;
  holdExpiresAt: Date | null;
  price: number;
  seat: ExistingSeat;
}

// ---- shared helpers ---------------------------------------------------------------------------

export function assertOwner<T extends { organizerId: string | null }>(
  event: T | null,
  organizerId: string,
): asserts event is NonNullable<T> {
  if (!event) throw new AppError(404, 'Event not found');
  if (event.organizerId !== organizerId) {
    throw new AppError(403, 'You can only manage events you created');
  }
}

/** An event is a cinema when it was created as one or its layout is the cinema template. */
export function isCinemaEvent(event: { category: string | null }, layout: any): boolean {
  return event.category?.toUpperCase() === 'CINEMA' || isCinemaVenueType(layout?.type);
}

const isLiveHold = (s: { status: SeatStatus; holdExpiresAt: Date | null }, now: number) =>
  s.status === SeatStatus.HELD && !!s.holdExpiresAt && s.holdExpiresAt.getTime() > now;

const isProtected = (s: SeatState, now: number) => s.status === SeatStatus.SOLD || isLiveHold(s, now);

async function loadSeatState(tx: Pick<Tx, 'eventSeat'>, eventId: string): Promise<SeatState[]> {
  const rows = await tx.eventSeat.findMany({
    where: { eventId },
    select: {
      id: true,
      showId: true,
      status: true,
      holdExpiresAt: true,
      price: true,
      seat: { select: { id: true, section: true, row: true, number: true, x: true, y: true, tier: true } },
    },
  });
  return rows;
}

/**
 * A cinema stores one EventSeat per physical seat *per show*. Capacity, layout growth and shrinking
 * are about physical seats, so collapse the rows into one entry per seat. A seat counts as sold or
 * held when it is sold or held in ANY show, which keeps it from being removed under a customer.
 * `id` of a collapsed entry is the Seat id; `eventSeatIds` lists every row behind it.
 */
export function collapseByPhysicalSeat(
  rows: SeatState[],
  now: number,
): Array<SeatState & { eventSeatIds: string[] }> {
  const bySeat = new Map<string, SeatState & { eventSeatIds: string[] }>();
  for (const r of rows) {
    const existing = bySeat.get(r.seat.id);
    if (!existing) {
      bySeat.set(r.seat.id, { ...r, id: r.seat.id, eventSeatIds: [r.id] });
      continue;
    }
    existing.eventSeatIds.push(r.id);
    if (r.status === SeatStatus.SOLD) existing.status = SeatStatus.SOLD;
    else if (existing.status !== SeatStatus.SOLD && isLiveHold(r, now)) {
      existing.status = SeatStatus.HELD;
      existing.holdExpiresAt = r.holdExpiresAt;
    }
  }
  return Array.from(bySeat.values());
}

/** The price new seats in a tier should get when the organizer didn't send one. */
function currentTierPrice(state: SeatState[], tier: string): number | undefined {
  const inTier = state.filter((s) => s.seat.tier === tier);
  const pool = inTier.filter((s) => s.status !== SeatStatus.SOLD);
  const source = pool.length ? pool : inTier;
  const counts = new Map<number, number>();
  for (const s of source) counts.set(s.price, (counts.get(s.price) ?? 0) + 1);
  let best: number | undefined;
  let bestN = 0;
  for (const [price, n] of counts) {
    if (n > bestN) {
      best = price;
      bestN = n;
    }
  }
  return best;
}

function tierSummary(state: SeatState[], now: number) {
  const tiers = new Map<string, { tier: string; total: number; sold: number; held: number; available: number }>();
  for (const s of state) {
    const t = tiers.get(s.seat.tier) ?? { tier: s.seat.tier, total: 0, sold: 0, held: 0, available: 0 };
    t.total += 1;
    if (s.status === SeatStatus.SOLD) t.sold += 1;
    else if (isLiveHold(s, now)) t.held += 1;
    else t.available += 1;
    tiers.set(s.seat.tier, t);
  }
  return Array.from(tiers.values());
}

/**
 * Seats belong to a venue, and older data could share one venue between several events. Before
 * changing seats or the venue name for one event, give it a private copy so other events are
 * untouched. Tickets and orders reference EventSeat rows, so they are unaffected by the copy.
 */
async function ensurePrivateVenue(tx: Tx, event: { id: string; venueId: string }): Promise<string> {
  const others = await tx.event.count({ where: { venueId: event.venueId, id: { not: event.id } } });
  if (others === 0) return event.venueId;

  const venue = await tx.venue.findUniqueOrThrow({ where: { id: event.venueId } });
  const clone = await tx.venue.create({
    data: { name: venue.name, layout: venue.layout as Prisma.InputJsonValue },
  });
  const seats = await tx.seat.findMany({ where: { eventSeats: { some: { eventId: event.id } } } });
  await tx.seat.createMany({
    data: seats.map((s) => ({
      venueId: clone.id,
      section: s.section,
      row: s.row,
      number: s.number,
      x: s.x,
      y: s.y,
      tier: s.tier,
    })),
  });
  await tx.$executeRaw`
    UPDATE "EventSeat" es
    SET "seatId" = ns.id
    FROM "Seat" os, "Seat" ns
    WHERE es."eventId" = ${event.id}
      AND es."seatId" = os.id
      AND ns."venueId" = ${clone.id}
      AND ns.section = os.section
      AND ns.row = os.row
      AND ns.number = os.number
  `;
  await tx.event.update({ where: { id: event.id }, data: { venueId: clone.id } });
  return clone.id;
}

// ---- show helpers -----------------------------------------------------------------------------

const MAX_SHOWS_PER_EVENT = 60;

type PriceMap = Record<string, number>;

/** Fill any missing tier so every show always stores a complete price list. */
function completePricing(partial: Partial<PriceMap> | null | undefined, fallback: PriceMap): PriceMap {
  return {
    VIP: partial?.VIP ?? fallback.VIP!,
    PREMIUM: partial?.PREMIUM ?? fallback.PREMIUM!,
    STANDARD: partial?.STANDARD ?? fallback.STANDARD!,
  };
}

function assertFutureShow(startsAt: Date, label = 'The show timing') {
  if (Number.isNaN(startsAt.getTime())) throw new AppError(400, `${label} is not a valid date`);
  if (startsAt.getTime() <= Date.now()) throw new AppError(400, `${label} must be in the future`);
}

/** The event's own start is always its earliest show, and its capacity is the number of seat rows. */
async function syncEventAggregates(tx: Tx, eventId: string) {
  const [first, capacity] = await Promise.all([
    tx.show.findFirst({ where: { eventId }, orderBy: { startsAt: 'asc' }, select: { startsAt: true } }),
    tx.eventSeat.count({ where: { eventId } }),
  ]);
  await tx.event.update({
    where: { id: eventId },
    data: { capacity, ...(first ? { startsAt: first.startsAt } : {}) },
  });
}

async function lockEvent(tx: Tx, eventId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  if (locked.length === 0) throw new AppError(404, 'Event not found');
}

/**
 * Cinema events created before show timings existed have seats with no show. The first time a show
 * is added they are moved under a show at the event's original time, so tickets already sold keep
 * working and the new show is simply the second one.
 */
async function adoptLegacySeats(tx: Tx, event: { id: string; startsAt: Date }, fallbackPrices: PriceMap) {
  const legacy = await tx.eventSeat.findMany({
    where: { eventId: event.id, showId: null },
    select: { id: true, price: true, seat: { select: { tier: true } } },
  });
  if (legacy.length === 0) return;

  const pricing: PriceMap = { ...fallbackPrices };
  const seen = new Set<string>();
  for (const row of legacy) {
    if (!seen.has(row.seat.tier)) {
      pricing[row.seat.tier] = row.price;
      seen.add(row.seat.tier);
    }
  }
  const show = await tx.show.create({
    data: { eventId: event.id, startsAt: event.startsAt, pricing, totalSeats: legacy.length },
  });
  await tx.eventSeat.updateMany({ where: { eventId: event.id, showId: null }, data: { showId: show.id } });
  await tx.order.updateMany({ where: { eventId: event.id, showId: null }, data: { showId: show.id } });
}

// ---- create -----------------------------------------------------------------------------------

export async function createEvent(input: CreateEventInput, organizerId: string) {
  const template = getVenueTemplate(input.venueType);
  const category = input.category || (isCinemaVenueType(input.venueType) ? 'CINEMA' : null);
  const isCinema = category?.toUpperCase() === 'CINEMA' || isCinemaVenueType(input.venueType);

  const plan = buildSeatPlan({
    venueType: input.venueType,
    totalSeats: input.totalSeats,
    seatsPerRow: input.seatsPerRow,
    vipSeats: input.vipSeats,
    premiumSeats: input.premiumSeats,
  });
  const basePrices: PriceMap = {
    VIP: input.pricing?.VIP ?? template.recommendedPricing.VIP,
    PREMIUM: input.pricing?.PREMIUM ?? template.recommendedPricing.PREMIUM,
    STANDARD: input.pricing?.STANDARD ?? template.recommendedPricing.STANDARD,
  };
  const venueName = input.venueName?.trim() || template.defaultName;

  // A cinema's schedule is its show list; every other event has a single start time.
  let showTimings: Array<{ startsAt: Date; pricing: PriceMap }> = [];
  let startsAt: Date;
  if (isCinema) {
    const requested = input.shows?.length ? input.shows : [{ startsAt: input.startsAt!, pricing: input.pricing }];
    showTimings = requested
      .map((s) => ({ startsAt: new Date(s.startsAt), pricing: completePricing(s.pricing, basePrices) }))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    showTimings.forEach((s, i) => assertFutureShow(s.startsAt, `Show timing #${i + 1}`));
    for (let i = 1; i < showTimings.length; i++) {
      if (showTimings[i]!.startsAt.getTime() === showTimings[i - 1]!.startsAt.getTime()) {
        throw new AppError(400, 'Two show timings are scheduled at the same time');
      }
    }
    startsAt = showTimings[0]!.startsAt;
  } else {
    startsAt = new Date(input.startsAt!);
    if (startsAt.getTime() <= Date.now()) {
      throw new AppError(400, 'The event start time must be in the future');
    }
  }

  // Venue, seats, event and its EventSeats are created together so a failure can't leave a
  // published event with no (or only some) seats.
  return prisma.$transaction(
    async (tx) => {
      // Each event gets its own venue record, so its capacity can differ from every other event.
      const venue = await tx.venue.create({ data: { name: venueName, layout: plan.layout as Prisma.InputJsonValue } });
      const seats = await tx.seat.createManyAndReturn({
        data: plan.seats.map((s) => ({ ...s, venueId: venue.id })),
        select: { id: true, tier: true },
      });

      const event = await tx.event.create({
        data: {
          venueId: venue.id,
          organizerId,
          title: input.title,
          description: input.description || null,
          category,
          location: input.location ?? null,
          imageUrl: input.imageUrl ?? null,
          startsAt,
          capacity: seats.length * Math.max(1, showTimings.length),
        },
      });

      if (isCinema) {
        for (const timing of showTimings) {
          const createdShow = await tx.show.create({
            data: { eventId: event.id, startsAt: timing.startsAt, pricing: timing.pricing, totalSeats: seats.length },
          });
          await tx.eventSeat.createMany({
            data: seats.map((seat) => ({
              eventId: event.id,
              showId: createdShow.id,
              seatId: seat.id,
              price: timing.pricing[seat.tier] ?? timing.pricing.STANDARD!,
              status: SeatStatus.AVAILABLE,
            })),
          });
        }
      } else {
        await tx.eventSeat.createMany({
          data: seats.map((seat) => ({
            eventId: event.id,
            seatId: seat.id,
            price: basePrices[seat.tier] ?? basePrices.STANDARD!,
            status: SeatStatus.AVAILABLE,
          })),
        });
      }

      return { event, seatsCount: seats.length, seatsPerRow: plan.seatsPerRow, tierCounts: plan.tierCounts };
    },
    { timeout: 60000 },
  );
}

// ---- read for the edit form -------------------------------------------------------------------

export async function getEventForEdit(eventId: string, organizerId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: true } });
  assertOwner(event, organizerId);

  const now = Date.now();
  const layout = event.venue.layout as any;
  const isCinema = isCinemaEvent(event, layout);
  const rawState = await loadSeatState(prisma, eventId);
  // Capacity, tiers and layout are about physical seats; a cinema repeats them once per show.
  const state = isCinema ? collapseByPhysicalSeat(rawState, now) : rawState;
  const tiers = tierSummary(state, now);

  const rows = new Map<string, number>();
  for (const s of state) rows.set(s.seat.row, (rows.get(s.seat.row) ?? 0) + 1);
  const seatsPerRow = layout?.config?.seatsPerRow ?? Math.max(0, ...Array.from(rows.values()));

  const shows = isCinema
    ? await prisma.show.findMany({ where: { eventId }, orderBy: { startsAt: 'asc' } })
    : [];
  const hasShows = shows.length > 0;

  const pricing: Record<string, number | null> = {};
  for (const tier of PRICING_TIERS) pricing[tier] = hasShows ? null : (currentTierPrice(rawState, tier) ?? null);

  const soldTickets = rawState.filter((s) => s.status === SeatStatus.SOLD).length;
  const heldNow = rawState.filter((s) => isLiveHold(s, now)).length;
  const protectedSeats = state.filter((s) => isProtected(s, now)).length;

  const showStats = shows.map((show) => {
    const own = rawState.filter((r) => r.showId === show.id);
    const sold = own.filter((r) => r.status === SeatStatus.SOLD);
    const held = own.filter((r) => isLiveHold(r, now)).length;
    return {
      id: show.id,
      startsAt: show.startsAt,
      pricing: show.pricing,
      totalSeats: own.length,
      soldSeats: sold.length,
      heldSeats: held,
      availableSeats: own.length - sold.length - held,
      soldOut: own.length > 0 && own.length - sold.length - held === 0,
      revenueCents: sold.reduce((sum, r) => sum + r.price, 0),
    };
  });

  const lastShowStart = hasShows ? Math.max(...shows.map((s) => s.startsAt.getTime())) : null;
  const eventOver = lastShowStart !== null ? lastShowStart <= now : event.startsAt.getTime() <= now;

  return {
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      category: event.category,
      location: event.location,
      imageUrl: event.imageUrl,
      startsAt: event.startsAt,
      status: event.status,
      updatedAt: event.updatedAt,
      venueName: event.venue.name,
      venueType: layout?.type ?? 'OTHERS',
    },
    /** Cinema with show timings: its date and prices are edited per show. */
    isCinema: hasShows,
    /** Any cinema can manage show timings, including older ones that have none yet. */
    canManageShows: isCinema,
    shows: showStats,
    seating: {
      // Physical seats (per show for a cinema)
      capacity: state.length,
      seatsPerRow,
      sold: soldTickets,
      held: heldNow,
      available: rawState.length - soldTickets - heldNow,
      showCount: shows.length,
      minCapacity: protectedSeats,
      maxCapacity: MAX_SEATS_PER_EVENT,
      tiers,
    },
    pricing,
    editable: !eventOver && event.status !== 'CANCELLED' && event.status !== 'COMPLETED',
  };
}

// ---- update -----------------------------------------------------------------------------------

export interface UpdateEventResult {
  event: { id: string; title: string; startsAt: Date; updatedAt: Date; capacity: number };
  summary: {
    capacity: number;
    sold: number;
    held: number;
    available: number;
    seatsAdded: number;
    seatsRemoved: number;
    pricing: Array<{ tier: string; price: number; updatedSeats: number; keptSoldSeats: number; keptHeldSeats: number }>;
    changes: string[];
  };
  /** Set when customers with tickets should be told about a date / venue / location change. */
  notify: null | {
    changes: string[];
    title: string;
    startsAt: Date;
    venueName: string;
    location: string | null;
    emails: string[];
  };
}

export async function updateEvent(eventId: string, organizerId: string, input: UpdateEventInput): Promise<UpdateEventResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      // Serialize edits of the same event, then check ownership against the locked row.
      await lockEvent(tx, eventId);

      const event = await tx.event.findUnique({ where: { id: eventId }, include: { venue: true } });
      assertOwner(event, organizerId);
      const ev = event;

      const now = Date.now();
      const isCinema = isCinemaEvent(ev, ev.venue.layout);
      const shows = isCinema ? await tx.show.findMany({ where: { eventId }, orderBy: { startsAt: 'asc' } }) : [];
      const useShows = isCinema && shows.length > 0;

      // A cinema that already has shows is scheduled and priced per show. (Older cinemas with no
      // shows yet keep editing their single start time and prices until a first show is added.)
      if (useShows && (input.startsAt !== undefined || input.pricing !== undefined)) {
        throw new AppError(
          400,
          'A cinema’s dates and ticket prices belong to its show timings. Edit them on the show instead.',
        );
      }

      if (ev.status === 'CANCELLED' || ev.status === 'COMPLETED') {
        throw new AppError(409, `A ${ev.status.toLowerCase()} event can no longer be edited`);
      }
      const lastStart = useShows ? Math.max(...shows.map((s) => s.startsAt.getTime())) : ev.startsAt.getTime();
      if (lastStart <= now) {
        throw new AppError(409, useShows ? 'Every show has already started, so this event can no longer be edited' : 'This event has already started and can no longer be edited');
      }
      if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== ev.updatedAt.getTime()) {
        throw new AppError(409, 'This event was changed somewhere else. Reload to see the latest version, then try again.', {
          code: 'STALE_EVENT',
        });
      }

      const newStart = input.startsAt ? new Date(input.startsAt) : null;
      if (newStart && newStart.getTime() <= now) {
        throw new AppError(400, 'The event start time must be in the future');
      }

      let rawState = await loadSeatState(tx, eventId);
      let state: SeatState[] = isCinema ? collapseByPhysicalSeat(rawState, now) : rawState;
      const sold = rawState.filter((s) => s.status === SeatStatus.SOLD).length;
      const held = rawState.filter((s) => isLiveHold(s, now)).length;
      const currentCapacity = state.length;
      const targetCapacity = input.totalSeats ?? currentCapacity;

      // What changes for people who already bought tickets?
      const dateChanged = !!newStart && newStart.getTime() !== ev.startsAt.getTime();
      const venueChanged = input.venueName !== undefined && input.venueName !== ev.venue.name;
      const locationChanged = input.location !== undefined && (input.location ?? null) !== (ev.location ?? null);
      const customerFacing: string[] = [];
      if (dateChanged) customerFacing.push('Date and time changed');
      if (venueChanged) customerFacing.push(`Venue changed to ${input.venueName}`);
      if (locationChanged) customerFacing.push(input.location ? `Location changed to ${input.location}` : 'Location deleted');

      if (sold > 0 && customerFacing.length > 0 && !input.confirm) {
        throw new AppError(
          409,
          `${sold} ticket${sold === 1 ? ' has' : 's have'} already been sold. Confirm to save changes to the date, venue or location; ticket holders will be emailed.`,
          {
            code: 'CONFIRMATION_REQUIRED',
            impact: { soldSeats: sold, heldSeats: held, changes: customerFacing },
          },
        );
      }

      // ---- seat capacity ----
      let seatsAdded = 0;
      let seatsRemoved = 0;
      let venueId = ev.venueId;
      const priceOverride: Record<string, number | undefined> = {
        VIP: input.pricing?.VIP,
        PREMIUM: input.pricing?.PREMIUM,
        STANDARD: input.pricing?.STANDARD,
      };

      if (targetCapacity !== currentCapacity || (venueChanged && input.venueName)) {
        venueId = await ensurePrivateVenue(tx, { id: ev.id, venueId: ev.venueId });
        if (venueId !== ev.venueId) {
          rawState = await loadSeatState(tx, eventId); // seat ids were remapped
          state = isCinema ? collapseByPhysicalSeat(rawState, now) : rawState;
        }
      }

      let layout: any = venueId === ev.venueId ? ev.venue.layout : (await tx.venue.findUniqueOrThrow({ where: { id: venueId } })).layout;

      if (targetCapacity > currentCapacity) {
        const add = targetCapacity - currentCapacity;
        const planned = planExtension(state.map((s) => s.seat), layout, add);
        const fallbackTier = planned[0]?.tier ?? 'STANDARD';
        const created = await tx.seat.createManyAndReturn({
          data: planned.map((p) => ({ ...p, venueId })),
          select: { id: true, tier: true },
        });
        if (useShows) {
          // New physical seats appear in every show, at that show's own price for the tier.
          const rows = shows.flatMap((show) => {
            const showPrices = (show.pricing ?? {}) as Partial<PriceMap>;
            const fallback = currentTierPrice(rawState.filter((r) => r.showId === show.id), fallbackTier);
            const price = showPrices[fallbackTier] ?? fallback;
            if (price === undefined) throw new AppError(500, 'Could not work out a price for the new seats');
            return created.map((c) => ({ eventId, showId: show.id, seatId: c.id, price, status: SeatStatus.AVAILABLE }));
          });
          await tx.eventSeat.createMany({ data: rows });
        } else {
          const tierPrice = priceOverride[fallbackTier] ?? currentTierPrice(rawState, fallbackTier);
          if (tierPrice === undefined) throw new AppError(500, 'Could not work out a price for the new seats');
          await tx.eventSeat.createMany({
            data: created.map((c) => ({ eventId, seatId: c.id, price: tierPrice, status: SeatStatus.AVAILABLE })),
          });
        }
        seatsAdded = created.length;
      } else if (targetCapacity < currentCapacity) {
        const remove = currentCapacity - targetCapacity;
        const ids = planShrink(
          state.map((s) => ({ ...s.seat, id: s.id, protected: isProtected(s, now) })),
          remove,
        );
        // Guarded delete: only seats that are still free at this instant. If a customer grabbed
        // one a moment ago the counts differ and the whole edit rolls back.
        let deleted: number;
        let expected: number;
        let physicalSeatIds: string[];
        if (isCinema) {
          physicalSeatIds = ids; // collapsed ids are Seat ids
          const byId = new Map(state.map((s) => [s.id, (s as SeatState & { eventSeatIds: string[] }).eventSeatIds.length]));
          expected = ids.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0);
          deleted = await tx.$executeRaw`
            DELETE FROM "EventSeat"
            WHERE "eventId" = ${eventId}
              AND "seatId" IN (${Prisma.join(ids)})
              AND (
                status = 'AVAILABLE'::"SeatStatus"
                OR (status = 'HELD'::"SeatStatus" AND "holdExpiresAt" < NOW())
              )
          `;
        } else {
          const seatIdByEventSeat = new Map(state.map((s) => [s.id, s.seat.id]));
          physicalSeatIds = ids.map((id) => seatIdByEventSeat.get(id)!);
          expected = ids.length;
          deleted = await tx.$executeRaw`
            DELETE FROM "EventSeat"
            WHERE "eventId" = ${eventId}
              AND id IN (${Prisma.join(ids)})
              AND (
                status = 'AVAILABLE'::"SeatStatus"
                OR (status = 'HELD'::"SeatStatus" AND "holdExpiresAt" < NOW())
              )
          `;
        }
        if (deleted !== expected) {
          throw new AppError(409, 'Some seats were just booked or held by customers. Please try again.');
        }
        await tx.seat.deleteMany({ where: { venueId, id: { in: physicalSeatIds } } });
        seatsRemoved = ids.length;
      }

      // ---- seats changed: refresh layout metadata, capacity counter and venue name ----
      let finalRaw = rawState;
      let finalState = state;
      if (seatsAdded || seatsRemoved) {
        finalRaw = await loadSeatState(tx, eventId);
        finalState = isCinema ? collapseByPhysicalSeat(finalRaw, now) : finalRaw;
      }
      if (finalState.length > MAX_SEATS_PER_EVENT) {
        throw new AppError(400, `An event can have at most ${MAX_SEATS_PER_EVENT} seats`);
      }
      if (seatsAdded || seatsRemoved) {
        layout = refreshLayoutMeta(layout, finalState.map((s) => s.seat), finalState.length);
      }
      if (seatsAdded || seatsRemoved || (venueChanged && input.venueName)) {
        await tx.venue.update({
          where: { id: venueId },
          data: {
            layout: layout as Prisma.InputJsonValue,
            ...(venueChanged && input.venueName ? { name: input.venueName } : {}),
          },
        });
      }
      if (seatsAdded || seatsRemoved) {
        // Each show keeps its own seat count in step with the venue.
        for (const show of shows) {
          await tx.show.update({ where: { id: show.id }, data: { totalSeats: finalState.length } });
        }
      }

      // ---- pricing: only seats that are free right now (non-cinema; cinema prices live on shows) ----
      const pricingReport: UpdateEventResult['summary']['pricing'] = [];
      for (const tier of PRICING_TIERS) {
        const price = input.pricing?.[tier];
        if (price === undefined) continue;
        const updated = await tx.$executeRaw`
          UPDATE "EventSeat" es
          SET price = ${price}, "updatedAt" = NOW()
          FROM "Seat" s
          WHERE es."seatId" = s.id
            AND es."eventId" = ${eventId}
            AND s.tier = ${tier}
            AND es.price <> ${price}
            AND (
              es.status = 'AVAILABLE'::"SeatStatus"
              OR (es.status = 'HELD'::"SeatStatus" AND es."holdExpiresAt" < NOW())
            )
        `;
        const kept = await tx.$queryRaw<Array<{ sold: bigint; held: bigint }>>`
          SELECT COUNT(*) FILTER (WHERE es.status = 'SOLD'::"SeatStatus" AND es.price <> ${price}) AS sold,
                 COUNT(*) FILTER (WHERE es.status = 'HELD'::"SeatStatus" AND es."holdExpiresAt" >= NOW() AND es.price <> ${price}) AS held
          FROM "EventSeat" es JOIN "Seat" s ON s.id = es."seatId"
          WHERE es."eventId" = ${eventId} AND s.tier = ${tier}
        `;
        pricingReport.push({
          tier,
          price,
          updatedSeats: updated,
          keptSoldSeats: Number(kept[0]?.sold ?? 0),
          keptHeldSeats: Number(kept[0]?.held ?? 0),
        });
      }

      // ---- event fields ----
      const updatedEvent = await tx.event.update({
        where: { id: eventId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(newStart ? { startsAt: newStart } : {}),
          // Always the number of seat rows (all shows included for a cinema)
          capacity: finalRaw.length,
        },
      });

      // Capacity counter, seat rows and the seat map must agree.
      const actual = await tx.eventSeat.count({ where: { eventId } });
      if (actual !== updatedEvent.capacity) {
        throw new AppError(500, 'Seat count mismatch after update; no changes were saved');
      }

      const changes: string[] = [];
      if (input.title !== undefined && input.title !== ev.title) changes.push('Title updated');
      if (input.description !== undefined && (input.description ?? null) !== (ev.description ?? null)) changes.push('Description updated');
      if (input.imageUrl !== undefined && (input.imageUrl ?? null) !== (ev.imageUrl ?? null)) changes.push('Image updated');
      changes.push(...customerFacing);
      if (seatsAdded) changes.push(`${seatsAdded} seat${seatsAdded === 1 ? '' : 's'} added${useShows ? ' to every show' : ''} (capacity ${finalState.length})`);
      if (seatsRemoved) changes.push(`${seatsRemoved} seat${seatsRemoved === 1 ? '' : 's'} deleted${useShows ? ' from every show' : ''} (capacity ${finalState.length})`);
      for (const p of pricingReport) if (p.updatedSeats > 0) changes.push(`${p.tier} price updated on ${p.updatedSeats} open seat${p.updatedSeats === 1 ? '' : 's'}`);

      let notify: UpdateEventResult['notify'] = null;
      if (sold > 0 && customerFacing.length > 0) {
        const orders = await tx.order.findMany({
          where: { eventId, status: 'CONFIRMED' },
          select: { user: { select: { email: true } } },
        });
        notify = {
          changes: customerFacing,
          title: updatedEvent.title,
          startsAt: updatedEvent.startsAt,
          venueName: input.venueName ?? ev.venue.name,
          location: updatedEvent.location,
          emails: Array.from(new Set(orders.map((o) => o.user.email))),
        };
      }

      const soldNow = finalRaw.filter((s) => s.status === SeatStatus.SOLD).length;
      const heldNow = finalRaw.filter((s) => isLiveHold(s, now)).length;
      return {
        event: {
          id: updatedEvent.id,
          title: updatedEvent.title,
          startsAt: updatedEvent.startsAt,
          updatedAt: updatedEvent.updatedAt,
          capacity: updatedEvent.capacity,
        },
        summary: {
          capacity: finalState.length,
          sold: soldNow,
          held: heldNow,
          available: finalRaw.length - soldNow - heldNow,
          seatsAdded,
          seatsRemoved,
          pricing: pricingReport,
          changes,
        },
        notify,
      } satisfies UpdateEventResult;
    },
    { timeout: 60000, maxWait: 10000 },
  );

  return result;
}

// ---- delete event -----------------------------------------------------------------------------

export async function deleteEvent(eventId: string, organizerId: string) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: { venue: true },
    });
    assertOwner(event, organizerId);

    // Delete tickets, orders, eventSeats, shows in safe dependency order
    await tx.ticket.deleteMany({
      where: {
        OR: [
          { order: { eventId } },
          { eventSeat: { eventId } },
        ],
      },
    });
    await tx.order.deleteMany({
      where: { eventId },
    });
    await tx.eventSeat.deleteMany({
      where: { eventId },
    });
    await tx.show.deleteMany({
      where: { eventId },
    });
    await tx.event.delete({
      where: { id: eventId },
    });

    // Check if the venue is used only by this event; if so, clean up venue & seats
    const otherEventsCount = await tx.event.count({
      where: { venueId: event.venueId },
    });
    if (otherEventsCount === 0) {
      await tx.seat.deleteMany({ where: { venueId: event.venueId } });
      await tx.venue.delete({ where: { id: event.venueId } });
    }

    return { success: true, message: 'Event deleted successfully' };
  });
}

// ---- show management --------------------------------------------------------------------------

/** Shared guard: the event must be the organizer's own, a cinema, and still open for changes. */
async function loadCinemaForShowChange(tx: Tx, eventId: string, organizerId: string) {
  await lockEvent(tx, eventId);
  const event = await tx.event.findUnique({ where: { id: eventId }, include: { venue: true } });
  assertOwner(event, organizerId);
  if (!isCinemaEvent(event, event.venue.layout)) {
    throw new AppError(400, 'Show timings are only available for cinema events');
  }
  if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
    throw new AppError(409, `A ${event.status.toLowerCase()} event can no longer be edited`);
  }
  return event;
}

export async function createShow(
  eventId: string,
  organizerId: string,
  input: { startsAt: string; pricing?: Partial<PriceMap> },
) {
  const startsAt = new Date(input.startsAt);
  assertFutureShow(startsAt);

  return prisma.$transaction(
    async (tx) => {
      const event = await loadCinemaForShowChange(tx, eventId, organizerId);

      const template = getVenueTemplate((event.venue.layout as any)?.type);
      const recommended = template.recommendedPricing as PriceMap;

      // New shows inherit the latest show's prices unless the organizer sets their own.
      const latest = await tx.show.findFirst({ where: { eventId }, orderBy: { createdAt: 'desc' } });
      const inherited = completePricing((latest?.pricing ?? null) as Partial<PriceMap> | null, recommended);

      await adoptLegacySeats(tx, event, inherited);

      const existing = await tx.show.findMany({ where: { eventId }, select: { startsAt: true } });
      if (existing.length >= MAX_SHOWS_PER_EVENT) {
        throw new AppError(409, `A cinema event can have at most ${MAX_SHOWS_PER_EVENT} show timings`);
      }
      if (existing.some((s) => s.startsAt.getTime() === startsAt.getTime())) {
        throw new AppError(409, 'A show is already scheduled at that date and time');
      }

      // The physical seats of this event (not the whole venue: older data could share venues).
      let seats = await tx.seat.findMany({
        where: { eventSeats: { some: { eventId } } },
        select: { id: true, tier: true },
      });
      if (seats.length === 0) {
        seats = await tx.seat.findMany({ where: { venueId: event.venueId }, select: { id: true, tier: true } });
      }
      if (seats.length === 0) throw new AppError(400, 'Event venue has no seats configured');

      const pricing = completePricing(input.pricing, inherited);
      const show = await tx.show.create({
        data: { eventId, startsAt, pricing, totalSeats: seats.length },
      });
      await tx.eventSeat.createMany({
        data: seats.map((seat) => ({
          eventId,
          showId: show.id,
          seatId: seat.id,
          price: pricing[seat.tier] ?? pricing.STANDARD!,
          status: SeatStatus.AVAILABLE,
        })),
      });

      await syncEventAggregates(tx, eventId);
      return show;
    },
    { timeout: 30000 },
  );
}

export async function updateShow(
  eventId: string,
  showId: string,
  organizerId: string,
  input: { startsAt?: string; pricing?: Partial<PriceMap>; confirm?: boolean },
) {
  return prisma.$transaction(
    async (tx) => {
      const event = await loadCinemaForShowChange(tx, eventId, organizerId);

      const show = await tx.show.findUnique({ where: { id: showId } });
      if (!show || show.eventId !== eventId) {
        throw new AppError(404, 'Show not found');
      }
      if (show.startsAt.getTime() <= Date.now()) {
        throw new AppError(409, 'This show has already started and can no longer be edited');
      }

      const soldRows = await tx.order.findMany({
        where: { showId, status: 'CONFIRMED' },
        select: { user: { select: { email: true } } },
      });
      const soldCount = await tx.eventSeat.count({ where: { showId, status: SeatStatus.SOLD } });

      const data: Prisma.ShowUpdateInput = {};
      let newStart: Date | null = null;
      if (input.startsAt) {
        newStart = new Date(input.startsAt);
        assertFutureShow(newStart);
        if (newStart.getTime() !== show.startsAt.getTime()) {
          const clash = await tx.show.findFirst({
            where: { eventId, startsAt: newStart, id: { not: showId } },
            select: { id: true },
          });
          if (clash) throw new AppError(409, 'Another show is already scheduled at that date and time');
          if (soldCount > 0 && !input.confirm) {
            throw new AppError(
              409,
              `${soldCount} ticket${soldCount === 1 ? ' has' : 's have'} already been sold for this show. Confirm to move it; ticket holders will be emailed.`,
              { code: 'CONFIRMATION_REQUIRED', impact: { soldSeats: soldCount } },
            );
          }
          data.startsAt = newStart;
        } else {
          newStart = null;
        }
      }

      if (input.pricing) {
        const recommended = getVenueTemplate((event.venue.layout as any)?.type).recommendedPricing as PriceMap;
        const current = completePricing((show.pricing ?? null) as Partial<PriceMap> | null, recommended);
        data.pricing = completePricing(input.pricing, current);
        // Only seats nobody has bought or is holding right now take the new price.
        for (const tier of PRICING_TIERS) {
          const price = input.pricing[tier];
          if (price === undefined) continue;
          await tx.eventSeat.updateMany({
            where: {
              showId,
              seat: { tier },
              OR: [
                { status: SeatStatus.AVAILABLE },
                { status: SeatStatus.HELD, holdExpiresAt: { lt: new Date() } },
              ],
            },
            data: { price },
          });
        }
      }

      const updated = await tx.show.update({ where: { id: showId }, data });
      await syncEventAggregates(tx, eventId);

      const notify =
        newStart && soldCount > 0
          ? {
              title: event.title,
              startsAt: newStart,
              venueName: event.venue.name,
              location: event.location,
              changes: ['Showtime changed'],
              emails: Array.from(new Set(soldRows.map((o) => o.user.email))),
            }
          : null;

      return { show: updated, notify };
    },
    { timeout: 30000 },
  );
}

export async function deleteShow(eventId: string, showId: string, organizerId: string) {
  return prisma.$transaction(
    async (tx) => {
      await loadCinemaForShowChange(tx, eventId, organizerId);

      const show = await tx.show.findUnique({ where: { id: showId } });
      if (!show || show.eventId !== eventId) {
        throw new AppError(404, 'Show not found');
      }

      // Never wipe out tickets customers have paid for.
      const sold = await tx.eventSeat.count({ where: { showId, status: SeatStatus.SOLD } });
      if (sold > 0) {
        throw new AppError(
          409,
          `${sold} ticket${sold === 1 ? ' has' : 's have'} already been sold for this show, so it can't be deleted.`,
          { code: 'SHOW_HAS_SALES', soldSeats: sold },
        );
      }
      const liveHolds = await tx.eventSeat.count({
        where: { showId, status: SeatStatus.HELD, holdExpiresAt: { gt: new Date() } },
      });
      if (liveHolds > 0) {
        throw new AppError(409, 'Customers are holding seats for this show right now. Try again in a few minutes.', {
          code: 'SHOW_HAS_HOLDS',
        });
      }
      const remaining = await tx.show.count({ where: { eventId, id: { not: showId } } });
      if (remaining === 0) {
        throw new AppError(409, 'A cinema event needs at least one show timing. Delete the event instead.', {
          code: 'LAST_SHOW',
        });
      }

      // Only unfinished orders can remain on a show with no sold seats.
      await tx.order.deleteMany({ where: { showId, status: { not: 'CONFIRMED' } } });
      await tx.eventSeat.deleteMany({ where: { showId } });
      await tx.show.delete({ where: { id: showId } });
      await syncEventAggregates(tx, eventId);

      return { success: true, message: 'Show deleted successfully' };
    },
    { timeout: 30000 },
  );
}
