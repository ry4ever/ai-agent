import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the DB queries so we can test the middleware logic in isolation
vi.mock('../src/db/queries', () => ({
  insertTransaction: vi.fn().mockResolvedValue({}),
  upsertDailyRevenue: vi.fn().mockResolvedValue(undefined),
}));

// Mock the logger
vi.mock('../src/middleware/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  paymentLogger: vi.fn(),
}));

import { trackRevenue, extractTxHash } from '../src/payments/revenue-tracker';
import { insertTransaction, upsertDailyRevenue } from '../src/db/queries';

function mockReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    method: 'GET',
    path: '/api/v1/test',
  } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

describe('trackRevenue middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default resolved implementations: vi.restoreAllMocks()
    // (afterEach) wipes mockResolvedValue, so without this the mocks return
    // undefined and .then()/.catch() on the decoupled writes would throw.
    vi.mocked(insertTransaction).mockResolvedValue({});
    vi.mocked(upsertDailyRevenue).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next() immediately (non-blocking)', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '2000');
    middleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('fires DB writes with correct endpoint and amount', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/sentiment', '2000');
    middleware(mockReq(), mockRes(), next);

    // Wait for the non-blocking Promise.all to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        service_endpoint: '/api/v1/sentiment',
        amount_usdc: 0.002,
      }),
    );
    expect(upsertDailyRevenue).toHaveBeenCalledWith(
      expect.objectContaining({
        service_endpoint: '/api/v1/sentiment',
        amount_usdc: 0.002,
      }),
    );
  });

  it('uses default agent address when header absent', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '1000');
    middleware(mockReq(), mockRes(), next);

    await new Promise((r) => setTimeout(r, 50));

    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_address: '0x0000000000000000000000000000000000000000',
      }),
    );
  });

  it('does not throw when DB writes fail (error is caught)', async () => {
    vi.mocked(insertTransaction).mockRejectedValueOnce(new Error('DB down'));
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '1000');

    expect(() => middleware(mockReq(), mockRes(), next)).not.toThrow();
    expect(next).toHaveBeenCalled();

    // Allow the rejected promise to settle without crashing the process
    await new Promise((r) => setTimeout(r, 50));
  });

  it('keeps insertTransaction and upsertDailyRevenue independent (decoupled)', async () => {
    // insertTransaction fails but upsertDailyRevenue must still be attempted
    vi.mocked(insertTransaction).mockRejectedValueOnce(new Error('unique violation'));
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '1000');
    middleware(mockReq(), mockRes(), next);

    await new Promise((r) => setTimeout(r, 50));

    expect(insertTransaction).toHaveBeenCalledTimes(1);
    expect(upsertDailyRevenue).toHaveBeenCalledTimes(1);
  });
});

describe('extractTxHash', () => {
  const EVM_TX = '0x' + 'a'.repeat(64); // valid 0x + 64 hex

  function b64(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
  }

  it('finds a nested EVM tx hash deep in the payment payload', () => {
    const header = b64({ x402Version: 1, scheme: 'exact', payload: { inner: { txHash: EVM_TX } } });
    expect(extractTxHash(header)).toBe(EVM_TX);
  });

  it('normalises the found hash to lowercase', () => {
    const upper = '0x' + 'ABCDEF'.repeat(10) + 'a'.repeat(4); // 64 hex
    const header = b64({ payload: { txHash: upper } });
    expect(extractTxHash(header)).toBe(upper.toLowerCase());
  });

  it('falls back to a deterministic sha256 when no tx hash is present', () => {
    const header = b64({ x402Version: 1, scheme: 'exact', network: 'base-sepolia' });
    const hash = extractTxHash(header);
    // '0x' + 64 hex = 66 chars, fits VARCHAR(66)
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(hash).toHaveLength(66);
    // deterministic: same input → same output
    expect(extractTxHash(header)).toBe(hash);
  });

  it('produces distinct hashes for distinct payments (no collisions)', () => {
    const h1 = extractTxHash(b64({ x402Version: 1, network: 'a' }));
    const h2 = extractTxHash(b64({ x402Version: 1, network: 'b' }));
    expect(h1).not.toBe(h2);
  });

  it('handles a non-JSON base64 header gracefully', () => {
    const hash = extractTxHash(Buffer.from('not-json-at-all').toString('base64'));
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
