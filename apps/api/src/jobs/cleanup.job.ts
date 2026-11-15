import { prisma } from '../db';
import { logger } from '../logger';
import { broadcastSeatsReleased } from '../socket';
import { redisConnection } from '../redis';

export async function cleanupExpiredHolds(): Promise<number> {
  // This single conditional UPDATE is intentionally atomic. A select-then-update can race
  // with a customer re-holding the same seat and incorrectly clear the newer hold.
  const expiredSeats = await prisma.$queryRaw<Array<{ eventId: string; showId: string | null; seatId: string }>>`
    UPDATE "EventSeat"
    SET
      status = 'AVAILABLE'::"SeatStatus",
      "heldByUserId" = NULL,
      "holdExpiresAt" = NULL,
      version = version + 1,
      "updatedAt" = NOW()
    WHERE status = 'HELD'::"SeatStatus"
      AND "holdExpiresAt" <= NOW()
    RETURNING "eventId", "showId", "seatId";
  `;

  if (expiredSeats.length === 0) return 0;

  // Broadcast only the rows the atomic update actually released, per event and show: a cinema
  // seat exists once per show, so clients need to know which show's seat map to update.
  const groups = new Map<string, { eventId: string; showId: string | null; seatIds: string[] }>();
  for (const seat of expiredSeats) {
    const key = `${seat.eventId}|${seat.showId ?? ''}`;
    const group = groups.get(key) ?? { eventId: seat.eventId, showId: seat.showId, seatIds: [] };
    group.seatIds.push(seat.seatId);
    groups.set(key, group);
  }

  for (const { eventId, showId, seatIds } of groups.values()) {
    broadcastSeatsReleased(eventId, { seatIds, showId: showId ?? undefined });
  }

  redisConnection.del('cache:events:published').catch(() => null);

  logger.info(`Cleanup job tidy-up: released ${expiredSeats.length} expired holds`);
  return expiredSeats.length;
}

export function startPeriodicCleanup(intervalMs = 60000) {
  logger.info(`Starting periodic hold cleanup job every ${intervalMs / 1000}s`);

  const interval = setInterval(() => {
    cleanupExpiredHolds().catch((err) => {
      logger.error(err, 'Error in periodic hold cleanup job');
    });
  }, intervalMs);

  return () => clearInterval(interval);
}
