import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const start = Date.now();
  try {
    const db = getPool();
    // Verify connectivity AND that the critical tables exist — a bare
    // "SELECT 1" would pass even if migrations never ran (the exact
    // scenario that hides the disconnected state).
    const result = await db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') AS has_tx_table`
    );
    const hasTable = result.rows[0]?.has_tx_table === true;
    return {
      ok: hasTable,
      latencyMs: Date.now() - start,
      detail: hasTable ? undefined : 'transactions table missing — migrations may not have run',
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface Transaction {
  id: string;
  tx_hash: string;
  agent_address: string;
  service_endpoint: string;
  amount_usdc: number;
  timestamp: Date;
  status: string;
  metadata?: Record<string, unknown>;
}

export async function insertTransaction(params: {
  tx_hash: string;
  agent_address: string;
  service_endpoint: string;
  amount_usdc: number;
  metadata?: Record<string, unknown>;
}): Promise<Transaction> {
  const db = getPool();
  const result = await db.query<Transaction>(
    `INSERT INTO transactions (id, tx_hash, agent_address, service_endpoint, amount_usdc, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      uuidv4(),
      params.tx_hash,
      params.agent_address.toLowerCase(),
      params.service_endpoint,
      params.amount_usdc,
      JSON.stringify(params.metadata ?? {}),
    ]
  );
  return result.rows[0];
}

export async function upsertDailyRevenue(params: {
  service_endpoint: string;
  amount_usdc: number;
  agent_address: string;
}): Promise<void> {
  const db = getPool();
  const today = new Date().toISOString().split('T')[0];
  await db.query(
    `INSERT INTO revenue_daily (date, service_endpoint, total_usdc, total_requests, unique_agents)
     VALUES ($1, $2, $3, 1, 1)
     ON CONFLICT (date, service_endpoint) DO UPDATE SET
       total_usdc = revenue_daily.total_usdc + EXCLUDED.total_usdc,
       total_requests = revenue_daily.total_requests + 1,
       unique_agents = (
         SELECT COUNT(DISTINCT agent_address)
         FROM transactions
         WHERE DATE(timestamp) = $1::date
           AND service_endpoint = $2
       )`,
    [today, params.service_endpoint, params.amount_usdc]
  );
}

export async function recordAgentRequest(params: {
  agent_address: string;
  service_endpoint: string;
  paid: boolean;
  response_ms?: number;
}): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO agent_requests (id, agent_address, service_endpoint, paid, response_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      uuidv4(),
      params.agent_address.toLowerCase(),
      params.service_endpoint,
      params.paid,
      params.response_ms ?? null,
    ]
  );
}

export interface RevenueStats {
  total_usdc: number;
  total_requests: number;
  unique_agents: number;
  top_services: Array<{ endpoint: string; total_usdc: number; total_requests: number }>;
}

export async function getRevenueStats(days = 7): Promise<RevenueStats> {
  const db = getPool();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totalsResult, topServicesResult] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(total_usdc), 0) AS total_usdc,
         COALESCE(SUM(total_requests), 0) AS total_requests,
         COALESCE(SUM(unique_agents), 0) AS unique_agents
       FROM revenue_daily
       WHERE date >= $1`,
      [since.toISOString().split('T')[0]]
    ),
    db.query(
      `SELECT service_endpoint AS endpoint,
              SUM(total_usdc) AS total_usdc,
              SUM(total_requests) AS total_requests
       FROM revenue_daily
       WHERE date >= $1
       GROUP BY service_endpoint
       ORDER BY total_usdc DESC
       LIMIT 10`,
      [since.toISOString().split('T')[0]]
    ),
  ]);

  const totals = totalsResult.rows[0];
  return {
    total_usdc: parseFloat(totals.total_usdc),
    total_requests: parseInt(totals.total_requests),
    unique_agents: parseInt(totals.unique_agents),
    top_services: topServicesResult.rows.map((r) => ({
      endpoint: r.endpoint,
      total_usdc: parseFloat(r.total_usdc),
      total_requests: parseInt(r.total_requests),
    })),
  };
}

export interface TransactionPage {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Paginated list of recorded payments, newest first.
 * Optionally filtered by service_endpoint.
 */
export async function getTransactions(params: {
  limit?: number;
  offset?: number;
  service?: string;
}): Promise<TransactionPage> {
  const db = getPool();
  const limit = clampInt(params.limit ?? 50, 50, 1, 200);
  const offset = clampInt(params.offset ?? 0, 0, 0, 1_000_000);
  const service = params.service?.trim() || undefined;

  const cols =
    'id, tx_hash, agent_address, service_endpoint, amount_usdc::double precision AS amount_usdc, timestamp, status';

  const [listResult, countResult] = await Promise.all([
    service
      ? db.query<Transaction>(
          `SELECT ${cols} FROM transactions WHERE service_endpoint = $3 ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
          [limit, offset, service]
        )
      : db.query<Transaction>(
          `SELECT ${cols} FROM transactions ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
    service
      ? db.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM transactions WHERE service_endpoint = $1`,
          [service]
        )
      : db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM transactions`),
  ]);

  return {
    transactions: listResult.rows,
    total: countResult.rows[0].total,
    limit,
    offset,
  };
}

function clampInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export async function runMigrations(): Promise<void> {
  const db = getPool();
  const fs = await import('fs');
  const path = await import('path');
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await db.query(sql);
  }
}
