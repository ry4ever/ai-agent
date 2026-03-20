import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { Redis } from 'ioredis';
import { logger } from './logger';

let rateLimiter: RateLimiterRedis | RateLimiterMemory;

function getRedisClient(): Redis | null {
  try {
    const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    return client;
  } catch {
    return null;
  }
}

export function initRateLimiter(): void {
  const redisClient = getRedisClient();

  if (redisClient) {
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_agent',
      points: 100,        // 100 requests
      duration: 60,       // per 60 seconds
      blockDuration: 120, // block for 2 minutes if exceeded
    });
    logger.info('Rate limiter initialized with Redis backend');
  } else {
    rateLimiter = new RateLimiterMemory({
      keyPrefix: 'rl_agent',
      points: 100,
      duration: 60,
      blockDuration: 120,
    });
    logger.warn('Rate limiter initialized with in-memory backend (Redis unavailable)');
  }
}

export function rateLimitByAgent(req: Request, res: Response, next: NextFunction): void {
  // Key by agent wallet address if present, otherwise by IP
  const key = (req.headers['x-agent-address'] as string) ?? req.ip ?? 'unknown';

  if (!rateLimiter) {
    initRateLimiter();
  }

  rateLimiter
    .consume(key)
    .then(() => {
      next();
    })
    .catch(() => {
      logger.warn('Rate limit exceeded', { key, path: req.path });
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please slow down.',
        retryAfter: 60,
      });
    });
}
