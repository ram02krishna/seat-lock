import { Queue } from 'bullmq';
import { redisConnection } from '../redis';
import { logger } from '../logger';

export interface HoldExpiryData {
  eventId: string;    // Event containing the held seats
  seatIds: string[];  // Seats whose hold is expiring
  userId: string;     // User who placed the hold
}

// Create the BullMQ queue connected to Redis
export const holdExpiryQueue = new Queue<HoldExpiryData>('hold-expiry-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Schedule the delayed job
export async function scheduleHoldExpiry(data: HoldExpiryData, delayMs: number) {
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
