import { Request, Response } from 'express';
import { getPool } from '../db/queries';
import { getRedisClient } from '../utils/redis';

const startTime = Date.now();

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const checks = await runHealthChecks();
  const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    version: process.env.npm_package_version ?? '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    environment: process.env.NODE_ENV ?? 'development',
    network: process.env.NETWORK ?? 'base-sepolia',
    checks,
    timestamp: new Date().toISOString(),
  });
}

async function runHealthChecks(): Promise<Record<string, { status: string; latencyMs?: number }>> {
  const results: Record<string, { status: string; latencyMs?: number }> = {};

  // PostgreSQL check
  const pgStart = Date.now();
  try {
    await getPool().query('SELECT 1');
    results.postgres = { status: 'ok', latencyMs: Date.now() - pgStart };
  } catch {
    results.postgres = { status: 'error', latencyMs: Date.now() - pgStart };
  }

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
