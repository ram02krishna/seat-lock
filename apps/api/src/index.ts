import http from 'http';
import { app } from './app';
import { config } from './config';
import { logger } from './logger';
import { initSocket } from './socket';
import { startHoldExpiryWorker } from './jobs/holdExpiry.worker';
import { startPeriodicCleanup } from './jobs/cleanup.job';
import { redisConnection, isMockRedis } from './redis';
import { ensureDefaultOrganizer } from './services/organizerInit.service';

const server = http.createServer(app);

// Initialize Socket.IO
initSocket(server);

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

async function shutdown() {
  logger.info('Shutting down API server...');
  stopCleanup();
  if (worker && typeof worker.close === 'function') {
    await worker.close().catch(() => null);
  }
  if (redisConnection && typeof redisConnection.quit === 'function') {
    await redisConnection.quit().catch(() => null);
  }

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
