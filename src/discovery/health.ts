import { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { checkDbHealth } from '../db/queries';
import { getRedisClient } from '../utils/redis';
import { logger } from '../middleware/logger';
import { getNetworkLabel } from '../config/network';

const startTime = Date.now();

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const checks = await runHealthChecks();
  // 'connecting' (Redis mid-handshake after a deploy) and 'disabled' (Redis
  // intentionally unconfigured) are not failures — only 'error'/'unconfigured'
  // make the service degraded.
  const allHealthy = Object.values(checks).every(
    (c) => c.status === 'ok' || c.status === 'connecting' || c.status === 'disabled'
  );

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    version: process.env.npm_package_version ?? '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    environment: process.env.NODE_ENV ?? 'development',
    network: getNetworkLabel(),
    checks,
    timestamp: new Date().toISOString(),
  });
}

interface HealthCheck {
  status: string;
  latencyMs?: number;
  detail?: string;
}

async function runHealthChecks(): Promise<Record<string, HealthCheck>> {
  const results: Record<string, HealthCheck> = {};

  // PostgreSQL check — verifies connectivity AND that the transactions table exists
  const pgHealth = await checkDbHealth();
  results.postgres = pgHealth.ok
    ? { status: 'ok', latencyMs: pgHealth.latencyMs }
    : { status: 'error', latencyMs: pgHealth.latencyMs, detail: pgHealth.detail };

  // Redis check. The ioredis client auto-connects on first use, but with
  // enableOfflineQueue:false a ping before the connection establishes is
  // rejected instantly — which made /health report "degraded" for ~20s after
  // every deploy (while the public-proxy handshake completed). Wait briefly
  // for the connection to ready before pinging, and surface the real error
  // (previously it was swallowed by an empty catch).
  const redisStart = Date.now();
  try {
    const redis = getRedisClient();
    if (!redis) {
      results.redis = { status: 'disabled' };
    } else if (await waitForReady(redis, 2000)) {
      await redis.ping();
      results.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } else {
      // Still establishing the connection (typical right after a deploy).
      // Not a real failure — surface the connection state for transparency.
      results.redis = {
        status: 'connecting',
        latencyMs: Date.now() - redisStart,
        detail: `connection status: ${redis.status}`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Redis health check failed', { err: msg });
    results.redis = { status: 'error', latencyMs: Date.now() - redisStart, detail: msg };
  }

  // Wallet configured
  results.wallet = {
    status: process.env.WALLET_ADDRESS ? 'ok' : 'unconfigured',
  };

  return results;
}

/**
 * Resolve once the ioredis client reaches 'ready' (able to serve commands),
 * or after `timeoutMs` if it doesn't. Returns true if ready, false on timeout.
 */
function waitForReady(redis: Redis, timeoutMs: number): Promise<boolean> {
  if (redis.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      redis.removeListener('ready', onReady);
      resolve(false);
    }, timeoutMs);
    const onReady = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    redis.once('ready', onReady);
  });
}
