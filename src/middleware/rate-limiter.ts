import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { Redis } from 'ioredis';
import { logger } from './logger';

let rateLimiter: RateLimiterRedis | RateLimiterMemory;
let redisAvailable = true;

function getRedisClient(): Redis | null {
  try {
    const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
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
      points: 1000,
      duration: 60,
      blockDuration: 10,
    });
    logger.info('Rate limiter initialized with Redis backend');
  } else {
    fallbackToMemory();
  }
}

function fallbackToMemory(): void {
  rateLimiter = new RateLimiterMemory({
    keyPrefix: 'rl_agent',
    points: 1000,
    duration: 60,
    blockDuration: 10,
  });
  redisAvailable = false;
  logger.warn('Rate limiter using in-memory backend (Redis unavailable)');
}

export function rateLimitByAgent(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health' || req.path === '/stats' || req.path.startsWith('/.well-known/') || req.path === '/') {
    return next();
  }

  const key = req.ip ?? 'unknown';

  if (!rateLimiter) {
    initRateLimiter();
  }

  rateLimiter
    .consume(key)
    .then(() => {
      next();
    })
    .catch((rlRejected) => {
      if (rlRejected instanceof Error) {
        logger.error('Rate limiter backend error — failing open', {
          key,
          path: req.path,
          error: rlRejected.message,
        });
        next();
        return;
      }
      const retryAfter = Math.ceil((rlRejected?.msBeforeNext ?? 10000) / 1000);
      logger.warn('Rate limit exceeded', { key, path: req.path, retryAfter });
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please slow down.',
        retryAfter,
      });
    });
}
