import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../errors';
import { HoldSeatsSchema, ReleaseSeatsSchema } from '@repo/shared';
import { holdSeats, releaseSeats } from '../services/hold.service';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { broadcastSeatsHeld, broadcastSeatsReleased } from '../socket';
import { redisConnection } from '../redis';

export const eventsRouter = Router();

const CACHE_KEY_PUBLISHED_EVENTS = 'cache:events:published';

// Public: List all published events (cached with micro-TTL)
eventsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = await redisConnection.get(CACHE_KEY_PUBLISHED_EVENTS).catch(() => null);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }

    // Events that have already started are no longer bookable, so they don't belong in the list
    // unless they have upcoming showtimes in the future
    const now = new Date();
    const events = await prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { startsAt: { gt: now } },
          { shows: { some: { startsAt: { gt: now } } } },
        ],
      },
      include: {
        venue: {
          select: { id: true, name: true, layout: true },
        },
        shows: {
          where: { startsAt: { gt: now } },
          orderBy: { startsAt: 'asc' },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    // One aggregate query rather than pulling every seat row of every event into memory.
    // A hold that has lapsed but not yet been swept counts as available.
    const eventIds = events.map((e) => e.id);
    const stats = eventIds.length
      ? await prisma.$queryRaw<Array<{ eventId: string; total: bigint; available: bigint; minPrice: number | null }>>`
          SELECT "eventId",
                 COUNT(*) AS total,
                 COUNT(*) FILTER (
                   WHERE status = 'AVAILABLE'::"SeatStatus"
                      OR (status = 'HELD'::"SeatStatus" AND "holdExpiresAt" < NOW())
                 ) AS available,
                 MIN(price) AS "minPrice"
          FROM "EventSeat"
          WHERE "eventId" IN (${Prisma.join(eventIds)})
          GROUP BY "eventId"
        `
      : [];
    const statsByEvent = new Map(stats.map((r) => [r.eventId, r]));

    const eventsWithStats = events.map((event) => {
      const st = statsByEvent.get(event.id);
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        category: event.category,
        location: event.location,
        imageUrl: event.imageUrl,
        startsAt: event.shows.length > 0 ? event.shows[0]!.startsAt : event.startsAt,
        status: event.status,
        venue: event.venue,
        totalSeats: Number(st?.total ?? 0),
        availableSeats: Number(st?.available ?? 0),
        minPrice: st?.minPrice ?? 0,
        shows: event.shows.map((s) => ({
          id: s.id,
          startsAt: s.startsAt,
          pricing: s.pricing,
        })),
      };
    });

    const responsePayload = { events: eventsWithStats };
    await redisConnection
      .set(CACHE_KEY_PUBLISHED_EVENTS, JSON.stringify(responsePayload), 'EX', 5)
      .catch(() => null);

    res.status(200).json(responsePayload);
  } catch (err) {
    next(err);
  }
});

// Authenticated or guest check: Get current user's active seat hold if any
eventsRouter.get('/active-hold', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(200).json({ hold: null });
    }

    const now = new Date();
    let heldSeats = await prisma.eventSeat.findMany({
      where: {
        heldByUserId: userId,
        status: 'HELD',
        holdExpiresAt: { gt: now },
      },
      include: {
        seat: true,
        show: { select: { id: true, startsAt: true } },
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            venue: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [
        { seat: { section: 'asc' } },
        { seat: { row: 'asc' } },
        { seat: { number: 'asc' } },
      ],
    });

    if (heldSeats.length === 0) {
      return res.status(200).json({ hold: null });
    }

    // Holds are limited to one event at a time, but defend against legacy rows from before that
    // rule by describing only the event with the latest-expiring hold.
    const latest = heldSeats.reduce((a, b) => (a.holdExpiresAt! >= b.holdExpiresAt! ? a : b));
    const event = latest.event;
    heldSeats = heldSeats.filter((s) => s.eventId === event.id);
    const earliestExpiry = heldSeats.reduce((earliest, s) => {
      if (!s.holdExpiresAt) return earliest;
      return earliest
        ? new Date(s.holdExpiresAt) < new Date(earliest)
          ? s.holdExpiresAt
          : earliest
        : s.holdExpiresAt;
    }, heldSeats[0]!.holdExpiresAt);

    return res.status(200).json({
      hold: {
        eventId: event.id,
        showId: heldSeats[0]?.showId || null,
        showStartsAt: heldSeats[0]?.show?.startsAt || null,
        eventTitle: event.title,
        venueName: event.venue?.name,
        startsAt: heldSeats[0]?.show?.startsAt || event.startsAt,
        holdExpiresAt: earliestExpiry?.toISOString() || null,
        seats: heldSeats.map((es) => ({
          id: es.id,
          seatId: es.seat.id,
          section: es.seat.section,
          row: es.seat.row,
          number: es.seat.number,
          tier: es.seat.tier,
          price: es.price,
        })),
        totalPrice: heldSeats.reduce((sum, s) => sum + s.price, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Public: Get single event details with venue layout and available showtimes
eventsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
      },
    });

    if (!event || event.status !== 'PUBLISHED') {
      return next(new AppError(404, 'Event not found'));
    }

    const shows = await prisma.show.findMany({
      where: { eventId },
      include: {
        eventSeats: {
          select: { status: true, price: true, holdExpiresAt: true },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    const now = new Date();
    const showsWithStats = shows.map((s) => {
      const total = s.eventSeats.length;
      const available = s.eventSeats.filter(
        (es) => es.status === 'AVAILABLE' || (es.status === 'HELD' && es.holdExpiresAt && new Date(es.holdExpiresAt) < now)
      ).length;
      const sold = s.eventSeats.filter((es) => es.status === 'SOLD').length;
      const minPrice = s.eventSeats.length > 0 ? Math.min(...s.eventSeats.map((es) => es.price)) : 0;
      return {
        id: s.id,
        startsAt: s.startsAt,
        pricing: s.pricing,
        totalSeats: total,
        availableSeats: available,
        soldSeats: sold,
        soldOut: total > 0 && available === 0,
        minPrice,
      };
    });

    res.status(200).json({
      event: {
        ...event,
        shows: showsWithStats,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Public: Get event seats with computed real-time availability for an event or specific show
eventsRouter.get('/:id/seats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.id as string;
    const requestedShowId = typeof req.query.showId === 'string' && req.query.showId ? req.query.showId : undefined;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: true },
    });

    if (!event || event.status !== 'PUBLISHED') {
      return next(new AppError(404, 'Event not found'));
    }

    // Determine target show if event has multiple shows
    const shows = await prisma.show.findMany({
      where: { eventId },
      include: {
        eventSeats: {
          select: { status: true, price: true, holdExpiresAt: true },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    const now = new Date();
    const showsWithStats = shows.map((s) => {
      const total = s.eventSeats.length;
      const available = s.eventSeats.filter(
        (es) => es.status === 'AVAILABLE' || (es.status === 'HELD' && es.holdExpiresAt && new Date(es.holdExpiresAt) < now)
      ).length;
      const sold = s.eventSeats.filter((es) => es.status === 'SOLD').length;
      const minPrice = s.eventSeats.length > 0 ? Math.min(...s.eventSeats.map((es) => es.price)) : 0;
      return {
        id: s.id,
        startsAt: s.startsAt,
        pricing: s.pricing,
        totalSeats: total,
        availableSeats: available,
        soldSeats: sold,
        soldOut: total > 0 && available === 0,
        minPrice,
      };
    });

    // Ensure strict ascending chronological order (earliest show first)
    showsWithStats.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    let activeShowId = requestedShowId;
    if (!activeShowId && showsWithStats.length > 0) {
      // Pick first upcoming show chronologically, or earliest show
      const upcoming = showsWithStats.find((s) => new Date(s.startsAt).getTime() > Date.now());
      activeShowId = upcoming ? upcoming.id : showsWithStats[0]!.id;
    }

    // Fetch seats specifically for this show, or eventSeats where showId is null / any
    const eventSeats = await prisma.eventSeat.findMany({
      where: {
        eventId,
        ...(activeShowId ? { showId: activeShowId } : {}),
      },
      include: {
        seat: true,
      },
      orderBy: [
        { seat: { section: 'asc' } },
        { seat: { row: 'asc' } },
        { seat: { number: 'asc' } },
      ],
    });

    const currentUserId = req.user?.userId;

    const seats = eventSeats.map((es) => {
      let effectiveStatus = es.status;

      // Expired holds are treated as available
      if (es.status === 'HELD' && es.holdExpiresAt && new Date(es.holdExpiresAt) < now) {
        effectiveStatus = 'AVAILABLE';
      }

      const isHeldByMe =
        effectiveStatus === 'HELD' && !!currentUserId && es.heldByUserId === currentUserId;

      return {
        id: es.id,
        seatId: es.seat.id,
        section: es.seat.section,
        row: es.seat.row,
        number: es.seat.number,
        x: es.seat.x,
        y: es.seat.y,
        tier: es.seat.tier,
        price: es.price,
        status: effectiveStatus,
        isHeldByMe,
        holdExpiresAt: effectiveStatus === 'HELD' ? es.holdExpiresAt : null,
      };
    });

    const activeShow = showsWithStats.find((s) => s.id === activeShowId);

    res.status(200).json({
      eventId,
      showId: activeShowId || null,
      show: activeShow || null,
      shows: showsWithStats,
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        imageUrl: event.imageUrl,
        startsAt: activeShow ? activeShow.startsAt : event.startsAt,
        capacity: seats.length,
      },
      venue: event.venue,
      seats,
    });
  } catch (err) {
    next(err);
  }
});

// Hold seats (Atomic, concurrency-safe, all-or-nothing)
eventsRouter.post(
  '/:id/hold',
  requireAuth,
  validateBody(HoldSeatsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = req.params.id as string;
      const { seatIds, showId } = req.body;
      const userId = req.user!.userId;

      const result = await holdSeats({
        eventId,
        seatIds,
        userId,
        showId,
      });

      // Broadcast real-time seat hold to all clients in the room
      broadcastSeatsHeld(eventId, {
        seatIds: result.heldSeats.map((s) => s.seatId),
        heldByUserId: userId,
        holdExpiresAt: result.holdExpiresAt.toISOString(),
        showId,
      });

      if (result.releasedSeatIds && result.releasedSeatIds.length > 0) {
        broadcastSeatsReleased(eventId, {
          seatIds: result.releasedSeatIds,
          showId,
        });
      }

      for (const [otherEventId, otherSeatIds] of Object.entries(result.releasedElsewhere)) {
        broadcastSeatsReleased(otherEventId, { seatIds: otherSeatIds });
      }

      redisConnection.del(CACHE_KEY_PUBLISHED_EVENTS).catch(() => null);

      res.status(200).json({ ...result, showId });
    } catch (err) {
      next(err);
    }
  }
);

// Release held seats
eventsRouter.post(
  '/:id/release',
  requireAuth,
  validateBody(ReleaseSeatsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = req.params.id as string;
      const { seatIds, showId } = req.body;
      const userId = req.user!.userId;

      const result = await releaseSeats({
        eventId,
        seatIds,
        userId,
        showId,
      });

      // Only announce seats that were actually ours to release; echoing the request would let a
      // client make other people's held or sold seats look free on everyone's map.
      if (result.releasedSeatIds.length > 0) {
        broadcastSeatsReleased(eventId, { seatIds: result.releasedSeatIds, showId });
      }

      redisConnection.del(CACHE_KEY_PUBLISHED_EVENTS).catch(() => null);

      res.status(200).json({ ...result, showId });
    } catch (err) {
      next(err);
    }
  }
);
