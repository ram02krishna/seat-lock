import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';

function createRedisConnection(): Redis {
  const redisUrl = config.REDIS_URL || 'redis://localhost:6379';

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
  });

  client.on('connect', () => {
    logger.info('Connected to Redis');
  });

  client.on('error', (err: any) => {
    logger.warn({ msg: err.message }, 'Redis connection error');
  });

  return client;
}

export const redisConnection = createRedisConnection();
