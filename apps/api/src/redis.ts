import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { config } from './config';
import { logger } from './logger';

<<<<<<< HEAD
export const isMockRedis = config.REDIS_URL === 'mock' || (!config.REDIS_URL && config.NODE_ENV !== 'production');
=======
export const isMockRedis =
  config.REDIS_URL === 'mock' ||
  config.REDIS_URL === 'memory' ||
  process.env.USE_MOCK_REDIS === 'true' ||
  (!config.REDIS_URL && config.NODE_ENV !== 'production');
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7

function createRedisConnection(): Redis {
  if (isMockRedis) {
    logger.info('Using in-memory mock Redis (no Docker or external Redis required)');
    return new RedisMock() as unknown as Redis;
  }

  const redisUrl = config.REDIS_URL || 'redis://localhost:6379';
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (config.NODE_ENV !== 'production' && times > 2) {
        logger.warn(
          `Could not reach Redis at ${redisUrl}. To run without Docker/Redis, set REDIS_URL=mock in your .env`
        );
        return null;
      }
      return Math.min(times * 500, 3000);
    },
  });

  client.on('connect', () => {
    logger.info('Connected to Redis');
  });

  client.on('error', (err: any) => {
    logger.warn({ msg: err.message }, 'Redis connection issue');
  });

  return client;
}

export const redisConnection = createRedisConnection();

