import { Prisma, SeatStatus } from '@prisma/client';
import { MAX_SEATS_PER_EVENT, PRICING_TIERS } from '@repo/shared';
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

const isLiveHold = (s: { status: SeatStatus; holdExpiresAt: Date | null }, now: number) =>
  s.status === SeatStatus.HELD && !!s.holdExpiresAt && s.holdExpiresAt.getTime() > now;

const isProtected = (s: SeatState, now: number) => s.status === SeatStatus.SOLD || isLiveHold(s, now);

async function loadSeatState(tx: Pick<Tx, 'eventSeat'>, eventId: string): Promise<SeatState[]> {
  const rows = await tx.eventSeat.findMany({
    where: { eventId },
    select: {
      id: true,
      status: true,
      holdExpiresAt: true,
      price: true,
      seat: { select: { id: true, section: true, row: true, number: true, x: true, y: true, tier: true } },
    },
  });
  return rows;
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

// ---- create -----------------------------------------------------------------------------------

export async function createEvent(input: CreateEventInput, organizerId: string) {
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() <= Date.now()) {
    throw new AppError(400, 'The event start time must be in the future');
  }

  const template = getVenueTemplate(input.venueType);
  const plan = buildSeatPlan({
    venueType: input.venueType,
    totalSeats: input.totalSeats,
    seatsPerRow: input.seatsPerRow,
    vipSeats: input.vipSeats,
    premiumSeats: input.premiumSeats,
  });
  const prices: Record<string, number> = {
    VIP: input.pricing?.VIP ?? template.recommendedPricing.VIP,
    PREMIUM: input.pricing?.PREMIUM ?? template.recommendedPricing.PREMIUM,
    STANDARD: input.pricing?.STANDARD ?? template.recommendedPricing.STANDARD,
  };
  const venueName = input.venueName?.trim() || template.defaultName;

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
          location: input.location ?? null,
          imageUrl: input.imageUrl ?? null,
          startsAt,
          capacity: seats.length,
        },
      });
      await tx.eventSeat.createMany({
        data: seats.map((seat) => ({
          eventId: event.id,
          seatId: seat.id,
          price: prices[seat.tier] ?? prices.STANDARD!,
          status: SeatStatus.AVAILABLE,
        })),
      });
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
  const state = await loadSeatState(prisma, eventId);
  const tiers = tierSummary(state, now);
  const layout = event!.venue.layout as any;

  const rows = new Map<string, number>();
  for (const s of state) rows.set(s.seat.row, (rows.get(s.seat.row) ?? 0) + 1);
  const seatsPerRow = layout?.config?.seatsPerRow ?? Math.max(0, ...Array.from(rows.values()));

  const pricing: Record<string, number | null> = {};
  for (const tier of PRICING_TIERS) pricing[tier] = currentTierPrice(state, tier) ?? null;

  const sold = state.filter((s) => s.status === SeatStatus.SOLD).length;
  const held = state.filter((s) => isLiveHold(s, now)).length;

  return {
    event: {
      id: event!.id,
      title: event!.title,
      description: event!.description,
      location: event!.location,
      imageUrl: event!.imageUrl,
      startsAt: event!.startsAt,
      status: event!.status,
      updatedAt: event!.updatedAt,
      venueName: event!.venue.name,
      venueType: layout?.type ?? 'OTHERS',
    },
    seating: {
      capacity: state.length,
      seatsPerRow,
      sold,
      held,
      available: state.length - sold - held,
      minCapacity: sold + held,
      maxCapacity: MAX_SEATS_PER_EVENT,
      tiers,
    },
    pricing,
    editable: event!.startsAt.getTime() > now && event!.status !== 'CANCELLED' && event!.status !== 'COMPLETED',
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
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
      if (locked.length === 0) throw new AppError(404, 'Event not found');

      const event = await tx.event.findUnique({ where: { id: eventId }, include: { venue: true } });
      assertOwner(event, organizerId);
      const ev = event!;

      const now = Date.now();
      if (ev.status === 'CANCELLED' || ev.status === 'COMPLETED') {
        throw new AppError(409, `A ${ev.status.toLowerCase()} event can no longer be edited`);
      }
      if (ev.startsAt.getTime() <= now) {
        throw new AppError(409, 'This event has already started and can no longer be edited');
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

      let state = await loadSeatState(tx, eventId);
      const sold = state.filter((s) => s.status === SeatStatus.SOLD).length;
      const held = state.filter((s) => isLiveHold(s, now)).length;
      const currentCapacity = state.length;
      const targetCapacity = input.totalSeats ?? currentCapacity;

      // What changes for people who already bought tickets?
      const dateChanged = !!newStart && newStart.getTime() !== ev.startsAt.getTime();
      const venueChanged = input.venueName !== undefined && input.venueName !== ev.venue.name;
      const locationChanged = input.location !== undefined && (input.location ?? null) !== (ev.location ?? null);
      const customerFacing: string[] = [];
      if (dateChanged) customerFacing.push('Date and time changed');
      if (venueChanged) customerFacing.push(`Venue changed to ${input.venueName}`);
      if (locationChanged) customerFacing.push(input.location ? `Location changed to ${input.location}` : 'Location removed');

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
        if (venueId !== ev.venueId) state = await loadSeatState(tx, eventId); // seat ids were remapped
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
        const tierPrice = priceOverride[fallbackTier] ?? currentTierPrice(state, fallbackTier);
        if (tierPrice === undefined) throw new AppError(500, 'Could not work out a price for the new seats');
        await tx.eventSeat.createMany({
          data: created.map((c) => ({ eventId, seatId: c.id, price: tierPrice, status: SeatStatus.AVAILABLE })),
        });
        seatsAdded = created.length;
      } else if (targetCapacity < currentCapacity) {
        const remove = currentCapacity - targetCapacity;
        const ids = planShrink(
          state.map((s) => ({ ...s.seat, id: s.id, protected: isProtected(s, now) })),
          remove,
        );
        const seatIdByEventSeat = new Map(state.map((s) => [s.id, s.seat.id]));
        // Guarded delete: only seats that are still free at this instant. If a customer grabbed
        // one a moment ago the counts differ and the whole edit rolls back.
        const deleted = await tx.$executeRaw`
          DELETE FROM "EventSeat"
          WHERE "eventId" = ${eventId}
            AND id IN (${Prisma.join(ids)})
            AND (
              status = 'AVAILABLE'::"SeatStatus"
              OR (status = 'HELD'::"SeatStatus" AND "holdExpiresAt" < NOW())
            )
        `;
        if (deleted !== ids.length) {
          throw new AppError(409, 'Some seats were just booked or held by customers. Please try again.');
        }
        await tx.seat.deleteMany({ where: { venueId, id: { in: ids.map((id) => seatIdByEventSeat.get(id)!) } } });
        seatsRemoved = ids.length;
      }

      // ---- seats changed: refresh layout metadata, capacity counter and venue name ----
      const finalState = seatsAdded || seatsRemoved ? await loadSeatState(tx, eventId) : state;
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

      // ---- pricing: only seats that are free right now ----
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
          capacity: finalState.length,
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
      if (seatsAdded) changes.push(`${seatsAdded} seat${seatsAdded === 1 ? '' : 's'} added (capacity ${finalState.length})`);
      if (seatsRemoved) changes.push(`${seatsRemoved} seat${seatsRemoved === 1 ? '' : 's'} removed (capacity ${finalState.length})`);
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

      const soldNow = finalState.filter((s) => s.status === SeatStatus.SOLD).length;
      const heldNow = finalState.filter((s) => isLiveHold(s, now)).length;
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
          available: finalState.length - soldNow - heldNow,
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
