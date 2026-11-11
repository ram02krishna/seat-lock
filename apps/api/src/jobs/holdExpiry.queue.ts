import { Queue } from 'bullmq';
import { redisConnection, isMockRedis } from '../redis';
import { logger } from '../logger';

export interface HoldExpiryData {
  eventId: string;    // Event containing the held seats
  seatIds: string[];  // Seats whose hold is expiring
  userId: string;     // User who placed the hold
}

// For example, if User A holds seats A10 and A11 at Event E1, the job receives those identifiers in its data.

// Create the queue when live Redis is available
export const holdExpiryQueue = !isMockRedis
  ? new Queue<HoldExpiryData>('hold-expiry-queue', {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
      },
    })
  : null;

// Schedule the delayed job
export async function scheduleHoldExpiry(data: HoldExpiryData, delayMs: number) {
  if (isMockRedis || !holdExpiryQueue) {
    logger.debug(`Hold expiry scheduled via periodic DB cleanup (mock Redis active)`);
    return;
  }
  try {
    const job = await holdExpiryQueue.add('expire-seats', data, {
      delay: delayMs,
    });
    logger.info(`Scheduled hold expiry job ${job.id} for event ${data.eventId} in ${delayMs / 1000}s`);
    return job;
  } catch (err: any) {
    logger.warn({ msg: err?.message }, 'Failed to schedule hold expiry in BullMQ (periodic cleanup will release seats)');
  }
}
