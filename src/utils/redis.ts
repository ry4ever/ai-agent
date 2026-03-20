import { Redis } from 'ioredis';
import { logger } from '../middleware/logger';

let redisClient: Redis | null = null;
let connectionFailed = false;

export function getRedisClient(): Redis | null {
  if (connectionFailed) return null;
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        if (times > 3) {
          connectionFailed = true;
          logger.warn('Redis connection failed after retries — caching disabled');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      reconnectOnError: () => false,
    });

    redisClient.on('error', (err) => {
      logger.warn('Redis error', { err: (err as Error).message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
      connectionFailed = false;
    });

    return redisClient;
  } catch {
    connectionFailed = true;
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
