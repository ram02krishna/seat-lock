import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../errors';
import { scheduleHoldExpiry } from '../jobs/holdExpiry.queue';

const HOLD_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export async function holdSeats(params: {
  eventId: string;
  seatIds: string[];
  userId: string;
  showId?: string;
}) {
  const { eventId, seatIds, userId, showId } = params;

  if (seatIds.length === 0) {
    throw new AppError(400, 'Select at least one seat');
  }

  if (seatIds.length > 6) {
    throw new AppError(400, 'Maximum 6 seats per hold');
  }

  // Sort seatIds to prevent deadlocks when concurrent users request overlapping seats
  const sortedIds = [...new Set(seatIds)].sort();

  // Check event exists
  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });
  if (!event || event.status !== 'PUBLISHED') {
    throw new AppError(404, 'Event not found or not open for booking');
  }
  if (event.startsAt.getTime() <= Date.now()) {
    throw new AppError(400, 'This event has already started');
  }

  // Check user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw new AppError(401, 'User account not found. Please sign in again.');
  }

  // Run hold query inside transaction for all-or-nothing atomicity
  const { heldSeats, releasedSeatIds, releasedElsewhere, holdExpiresAt } = await prisma.$transaction(async (tx) => {
    // Serialize hold creation for a user. Without a row lock, two simultaneous requests for
    // different events can both observe no existing hold and leave the user holding both.
    const lockedUser = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE;
    `;
    if (lockedUser.length === 0) {
      throw new AppError(401, 'User account not found. Please sign in again.');
    }

    // Start the hold timer after acquiring the lock, not before waiting for another request.
    const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MS);

    // One active hold per user. Anything they currently hold that isn't part of this request is
    // let go, including seats at other events, so the UI only ever has one hold to describe.
    const existingUserHolds = await tx.eventSeat.findMany({
      where: {
        heldByUserId: userId,
        status: 'HELD',
        holdExpiresAt: { gt: new Date() },
      },
      select: { id: true, seatId: true, eventId: true, showId: true },
    });

    const releasedSeatIds: string[] = [];
    const releasedElsewhere: Record<string, string[]> = {};

    const seatsToRelease = existingUserHolds.filter(
      (h) =>
        !(
          h.eventId === eventId &&
          (showId ? h.showId === showId : true) &&
          (sortedIds.includes(h.id) || sortedIds.includes(h.seatId))
        ),
    );

    if (seatsToRelease.length > 0) {
      await tx.eventSeat.updateMany({
        where: {
          id: { in: seatsToRelease.map((s) => s.id) },
          heldByUserId: userId,
          status: 'HELD',
        },
        data: {
          status: 'AVAILABLE',
          heldByUserId: null,
          holdExpiresAt: null,
          version: { increment: 1 },
        },
      });
      for (const s of seatsToRelease) {
        if (s.eventId === eventId) {
          releasedSeatIds.push(s.seatId);
        } else {
          (releasedElsewhere[s.eventId] ??= []).push(s.seatId);
        }
      }
    }

    // Atomic conditional UPDATE:
    // Only take seats that are AVAILABLE, whose hold has already expired,
    // OR are already held by this user (allows refreshing/extending hold or re-selecting own seats).
    const updatedRows = await tx.$queryRaw<Array<{ id: string; seatId: string; price: number }>>`
      UPDATE "EventSeat"
      SET 
        status = 'HELD'::"SeatStatus",
        "heldByUserId" = ${userId},
        "holdExpiresAt" = ${holdExpiresAt},
        version = version + 1,
        "updatedAt" = NOW()
      WHERE "eventId" = ${eventId}
        ${showId ? Prisma.sql`AND "showId" = ${showId}` : Prisma.sql``}
        AND ("seatId" IN (${Prisma.join(sortedIds)}) OR id IN (${Prisma.join(sortedIds)}))
        AND (
          status = 'AVAILABLE'::"SeatStatus"
          OR (
            status = 'HELD'::"SeatStatus"
            AND ("holdExpiresAt" < NOW() OR "heldByUserId" = ${userId})
          )
        )
      RETURNING id, "seatId", price;
    `;

    // All-or-nothing check: if any requested seat wasn't acquired, rollback
    if (updatedRows.length !== sortedIds.length) {
      throw new AppError(409, 'One or more selected seats are no longer available');
    }

    return { heldSeats: updatedRows, releasedSeatIds, releasedElsewhere, holdExpiresAt };
  });

  // Schedule a delayed BullMQ job to release the seats if they are never confirmed. The database
  // is the source of truth (expired holds are ignored by every query and swept by the periodic
  // cleanup job), so don't make the customer wait on Redis, which could hang if it is unreachable.
  void scheduleHoldExpiry(
    {
      eventId,
      seatIds: heldSeats.map((s) => s.seatId),
      userId,
    },
    Math.max(1000, holdExpiresAt.getTime() - Date.now())
  );

  return {
    eventId,
    heldSeats,
    holdExpiresAt,
    releasedSeatIds,
    releasedElsewhere,
  };
}

export async function releaseSeats(params: {
  eventId: string;
  seatIds: string[];
  userId: string;
  showId?: string;
}) {
  const { eventId, seatIds, userId, showId } = params;
  const ids = [...new Set(seatIds)];

  if (ids.length === 0) {
    return { releasedCount: 0, releasedSeatIds: [] as string[] };
  }

  const updatedRows = await prisma.$queryRaw<Array<{ id: string; seatId: string }>>`
    UPDATE "EventSeat"
    SET 
      status = 'AVAILABLE'::"SeatStatus",
      "heldByUserId" = NULL,
      "holdExpiresAt" = NULL,
      version = version + 1,
      "updatedAt" = NOW()
    WHERE "eventId" = ${eventId}
      ${showId ? Prisma.sql`AND "showId" = ${showId}` : Prisma.sql``}
      AND "heldByUserId" = ${userId}
      AND ("seatId" IN (${Prisma.join(ids)}) OR id IN (${Prisma.join(ids)}))
      AND status = 'HELD'::"SeatStatus"
    RETURNING id, "seatId";
  `;

  return { releasedCount: updatedRows.length, releasedSeatIds: updatedRows.map((r) => r.seatId) };
}
