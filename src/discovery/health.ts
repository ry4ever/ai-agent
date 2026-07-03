import { Request, Response } from 'express';
import { checkDbHealth } from '../db/queries';
import { getRedisClient } from '../utils/redis';
import { getNetworkLabel } from '../config/network';

const startTime = Date.now();

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const checks = await runHealthChecks();
  const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

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

async function runHealthChecks(): Promise<Record<string, { status: string; latencyMs?: number; detail?: string }>> {
  const results: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};

  // PostgreSQL check — verifies connectivity AND that the transactions table exists
  const pgHealth = await checkDbHealth();
  results.postgres = pgHealth.ok
    ? { status: 'ok', latencyMs: pgHealth.latencyMs }
    : { status: 'error', latencyMs: pgHealth.latencyMs, detail: pgHealth.detail };

  // Redis check
  const redisStart = Date.now();
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.ping();
      results.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } else {
      results.redis = { status: 'disabled' };
    }
  } catch {
    results.redis = { status: 'error', latencyMs: Date.now() - redisStart };
  }

  // Wallet configured
  results.wallet = {
    status: process.env.WALLET_ADDRESS ? 'ok' : 'unconfigured',
  };

  return results;
}
