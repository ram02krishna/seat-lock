import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { config } from './config';
import { logger } from './logger';

export const isMockRedis = config.REDIS_URL === 'mock' || (!config.REDIS_URL && config.NODE_ENV !== 'production');

function createRedisConnection(): Redis {
  if (isMockRedis) {
    logger.info('Using in-memory mock Redis (no Docker or external Redis required)');
    return new RedisMock() as unknown as Redis;
  }

  const redisUrl = config.REDIS_URL || 'redis://localhost:6379';
  const mockFallback = new RedisMock() as unknown as Redis;
  let useFallback = false;

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (config.NODE_ENV !== 'production' && times > 2) {
        logger.warn(
          `Could not reach Redis at ${redisUrl}. Falling back to in-memory mock Redis for this session. (To silence this warning, set REDIS_URL=mock in your .env)`
        );
        useFallback = true;
        return null;
      }
      return Math.min(times * 500, 3000);
    },
  });

  client.on('connect', () => {
    useFallback = false;
    logger.info('Connected to Redis');
  });

  client.on('error', (err: any) => {
    logger.warn({ msg: err.message }, 'Redis connection issue');
    if (config.NODE_ENV !== 'production' && (client.status === 'end' || client.status === 'close')) {
      useFallback = true;
    }
  });

  // In non-production environments, if the external Redis connection closes or fails,
  // seamlessly route commands to the in-memory mock so routes (e.g. OTP verification) do not crash with 500.
  if (config.NODE_ENV !== 'production') {
    return new Proxy(client, {
      get(target, prop, receiver) {
        if (useFallback || target.status === 'end' || target.status === 'close') {
          const val = (mockFallback as any)[prop];
          return typeof val === 'function' ? val.bind(mockFallback) : val;
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }

  return client;
}

export const redisConnection = createRedisConnection();
