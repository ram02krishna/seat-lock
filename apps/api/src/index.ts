import http from 'http';
import { app } from './app';
import { config } from './config';
import { logger } from './logger';
import { initSocket } from './socket';
import { startHoldExpiryWorker } from './jobs/holdExpiry.worker';
import { startPeriodicCleanup } from './jobs/cleanup.job';
import { redisConnection, isMockRedis } from './redis';
import { ensureDefaultOrganizer } from './services/organizerInit.service';
<<<<<<< HEAD
import { prisma } from './db';
=======
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

const server = http.createServer(app);

// Initialize Socket.IO
<<<<<<< HEAD
const io = initSocket(server);
=======
initSocket(server);
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

// Start BullMQ worker (when running with live Redis) & periodic DB cleanup
let worker: ReturnType<typeof startHoldExpiryWorker> | null = null;
if (!isMockRedis) {
  try {
    worker = startHoldExpiryWorker();
  } catch (err: any) {
    logger.warn('BullMQ worker disabled (periodic DB cleanup will handle hold release)');
  }
} else {
  logger.info('Running with mock Redis: BullMQ worker bypassed, periodic DB cleanup will release expired holds');
}
const stopCleanup = startPeriodicCleanup(60000);

server.listen(config.PORT, async () => {
  logger.info(`API server running on http://localhost:${config.PORT}`);
  await ensureDefaultOrganizer();
});

<<<<<<< HEAD
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down API server...');

  // Safety net in case a connection refuses to close.
  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();

=======
async function shutdown() {
  logger.info('Shutting down API server...');
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
  stopCleanup();
  if (worker && typeof worker.close === 'function') {
    await worker.close().catch(() => null);
  }
<<<<<<< HEAD

  // Closes every WebSocket connection and then the underlying HTTP server
  io.close(async () => {
    await redisConnection.quit().catch(() => null);
    await prisma.$disconnect().catch(() => null);
=======
  if (redisConnection && typeof redisConnection.quit === 'function') {
    await redisConnection.quit().catch(() => null);
  }

  server.close(() => {
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
