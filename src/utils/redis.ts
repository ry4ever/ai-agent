import { Redis } from 'ioredis';
import { logger } from '../middleware/logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        if (times > 10) {
          logger.warn('Redis retry limit reached — backing off for 30s');
          return 30_000;
        }
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 3,
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
        if (targetErrors.some((e) => err.message.includes(e))) {
          return 2;
        }
        return false;
      },
    });

    redisClient.on('error', (err) => {
      logger.warn('Redis error', { err: (err as Error).message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    redisClient.on('reconnecting', (delay: number) => {
      logger.info('Redis reconnecting', { delayMs: delay });
    });

    return redisClient;
  } catch {
    logger.warn('Redis client creation failed — caching disabled');
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
