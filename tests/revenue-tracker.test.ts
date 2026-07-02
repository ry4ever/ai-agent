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

import { trackRevenue } from '../src/payments/revenue-tracker';
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
});
