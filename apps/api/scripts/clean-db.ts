import path from 'path';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaClient, SeatStatus } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning database data...');

  // 1. Delete all Tickets
  const deletedTickets = await prisma.ticket.deleteMany();
  console.log(`Deleted ${deletedTickets.count} tickets`);

  // 2. Delete all Orders
  const deletedOrders = await prisma.order.deleteMany();
  console.log(`Deleted ${deletedOrders.count} orders`);

  // 3. Delete all Users (accounts)
  const deletedUsers = await prisma.user.deleteMany();
  console.log(`Deleted ${deletedUsers.count} users/accounts`);

  // 4. Reset all EventSeats back to AVAILABLE (clear all holds and selections)
  const updatedSeats = await prisma.eventSeat.updateMany({
    data: {
      status: SeatStatus.AVAILABLE,
      heldByUserId: null,
      holdExpiresAt: null,
      version: 0,
    },
  });
  console.log(`Reset ${updatedSeats.count} event seats back to AVAILABLE (0 held, 0 sold)`);

  // 5. Clear Redis locks and queues
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null });
  redis.on('error', () => {});
  try {
    await redis.flushall();
    console.log('Flushed Redis cache and queues');
  } catch (err: any) {
    console.warn('Redis flush warning:', err.message);
  } finally {
    redis.disconnect();
  }

  // 6. Summary check
  const [users, orders, tickets, heldSeats, soldSeats, availSeats] = await Promise.all([
    prisma.user.count(),
    prisma.order.count(),
    prisma.ticket.count(),
    prisma.eventSeat.count({ where: { status: SeatStatus.HELD } }),
    prisma.eventSeat.count({ where: { status: SeatStatus.SOLD } }),
    prisma.eventSeat.count({ where: { status: SeatStatus.AVAILABLE } }),
  ]);

  console.log('Database Status:');
  console.log({
    users,
    orders,
    tickets,
    heldSeats,
    soldSeats,
    availableSeats: availSeats,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
