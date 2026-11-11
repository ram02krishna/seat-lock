import { Worker, Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { redisConnection } from '../redis';
import { prisma } from '../db';
import { logger } from '../logger';
import { broadcastSeatsReleased } from '../socket';
import { HoldExpiryData, scheduleHoldExpiry } from './holdExpiry.queue';

// Start the worker
export function startHoldExpiryWorker(): Worker {
  const worker = new Worker<HoldExpiryData>(
    'hold-expiry-queue',
    async (job: Job<HoldExpiryData>) => {
      const { eventId, seatIds, userId } = job.data;
      logger.info(`Processing hold expiry job ${job.id} for event ${eventId}`);

      if (seatIds.length === 0) return;

      // Release only seats that are still expired at the time of the UPDATE. A separate
      // find-then-update sequence can race with a new hold and accidentally release that hold.
      const releasedSeats = await prisma.$queryRaw<Array<{ seatId: string }>>`
        UPDATE "EventSeat"
        SET
          status = 'AVAILABLE'::"SeatStatus",
          "heldByUserId" = NULL,
          "holdExpiresAt" = NULL,
          version = version + 1,
          "updatedAt" = NOW()
        WHERE "eventId" = ${eventId}
          AND "seatId" IN (${Prisma.join(seatIds)})
          AND "heldByUserId" = ${userId}
          AND status = 'HELD'::"SeatStatus"
          AND "holdExpiresAt" <= NOW()
        RETURNING "seatId";
      `;

      if (releasedSeats.length > 0) {
        const releasedSeatIds = releasedSeats.map((seat) => seat.seatId);
        broadcastSeatsReleased(eventId, { seatIds: releasedSeatIds });
        redisConnection.del('cache:events:published').catch(() => null);
        logger.info(`Released ${releasedSeatIds.length} expired seats for event ${eventId}`);
      } else {
        logger.info(`No expired seats found for job ${job.id} (already confirmed, released, or renewed)`);
      }

      // A delayed job may wake slightly before its deadline, or a hold may have been
      // extended after this job was queued. Schedule another job for any seats still held
      // by this user, using the earliest current expiry rather than freeing them early.
      const activeSeats = await prisma.eventSeat.findMany({
        where: {
          eventId,
          seatId: { in: seatIds },
          heldByUserId: userId,
          status: 'HELD',
          holdExpiresAt: { gt: new Date() },
        },
        select: { seatId: true, holdExpiresAt: true },
      });

      if (activeSeats.length > 0) {
        const earliestExpiry = Math.min(
          ...activeSeats.map((seat) => seat.holdExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
        );
        const delayMs = Math.max(1000, earliestExpiry - Date.now());
        await scheduleHoldExpiry(
          { eventId, seatIds: activeSeats.map((seat) => seat.seatId), userId },
          delayMs,
        );
      }
    },
    {
      connection: redisConnection,
      concurrency: 5, // allows this worker to process up to five jobs concurrently
    }
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Hold expiry job failed');
  });

  worker.on('error', (err) => {
    logger.warn({ msg: err.message }, 'BullMQ worker error (periodic cleanup will handle hold expiries)');
  });

  return worker;
}
