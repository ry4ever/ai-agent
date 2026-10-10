import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB queries so we can test hook logic in isolation.
vi.mock('../src/db/queries', () => ({
  insertTransaction: vi.fn().mockResolvedValue({}),
  upsertDailyRevenue: vi.fn().mockResolvedValue(undefined),
}));

// Mock the logger — the hook logs loudly on timeout; the test asserts on it.
vi.mock('../src/middleware/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  paymentLogger: vi.fn(),
}));

import { revenueTrackerHook, EXPORTED_FOR_TESTS } from '../src/payments/revenue-tracker';
import { insertTransaction, upsertDailyRevenue } from '../src/db/queries';
import { logger } from '../src/middleware/logger';

function makeCtx(overrides: Record<string, unknown> = {}): Parameters<typeof revenueTrackerHook>[0] {
  const txHash = '0x' + 'a'.repeat(64);
  const base = {
    result: {
      success: true,
      transaction: txHash,
      payer: '0xAbCdEf0123456789abcdef0123456789aBcDeF01',
      network: 'eip155:84532',
    },
    paymentPayload: {
      payload: {
        authorization: {
          from: '0xAbCdEf0123456789abcdef0123456789aBcDeF01',
          to: '0x1111111111111111111111111111111111111111',
          value: '2000',
        },
      },
    },
    requirements: {
      amount: '2000',
      scheme: 'exact',
      network: 'eip155:84532',
    },
    declaredExtensions: {},
    transportContext: {
      request: { method: 'GET', path: '/api/v1/sentiment/AAPL' },
    },
  };
  return { ...base, ...overrides } as unknown as Parameters<typeof revenueTrackerHook>[0];
}

describe('revenueTrackerHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(insertTransaction).mockResolvedValue({} as never);
    vi.mocked(upsertDailyRevenue).mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('writes insertTransaction and upsertDailyRevenue on a successful settle', async () => {
    await revenueTrackerHook(makeCtx());
    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        service_endpoint: '/api/v1/sentiment',
        amount_usdc: 0.002,
        agent_address: '0xabcdef0123456789abcdef0123456789abcdef01',
      }),
    );
    expect(upsertDailyRevenue).toHaveBeenCalledWith(
      expect.objectContaining({ service_endpoint: '/api/v1/sentiment', amount_usdc: 0.002 }),
    );
  });

  it('does nothing when the settle result is not success', async () => {
    await revenueTrackerHook(makeCtx({ result: { success: false, transaction: '', network: 'eip155:84532' } }));
    expect(insertTransaction).not.toHaveBeenCalled();
    expect(upsertDailyRevenue).not.toHaveBeenCalled();
  });

  it('uses the result.transaction hash and lowercases it', async () => {
    const upper = '0x' + 'ABCDEF'.repeat(10) + 'a'.repeat(4);
    await revenueTrackerHook(makeCtx({
      result: { success: true, transaction: upper, payer: '0x0', network: 'eip155:84532' },
    }));
    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ tx_hash: upper.toLowerCase() }),
    );
  });

  it('derives the service endpoint label from a parameterised route', async () => {
    await revenueTrackerHook(makeCtx({
      transportContext: { request: { method: 'GET', path: '/api/v1/company/stripe.com' } },
    }));
    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ service_endpoint: '/api/v1/company' }),
    );
  });

  it('falls back to the authorization.from when result.payer is missing', async () => {
    await revenueTrackerHook(makeCtx({
      result: { success: true, transaction: '0x' + 'b'.repeat(64), network: 'eip155:84532' },
    }));
    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ agent_address: '0xabcdef0123456789abcdef0123456789abcdef01' }),
    );
  });

  it('releases within the DB write timeout when writes hang', async () => {
    vi.mocked(insertTransaction).mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(upsertDailyRevenue).mockImplementationOnce(() => new Promise(() => {}));

    const start = Date.now();
    await revenueTrackerHook(makeCtx());
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(3500);
    expect(logger.error).toHaveBeenCalledWith(
      'Revenue tracking writes exceeded timeout',
      expect.objectContaining({ event: 'revenue_write_timeout' }),
    );
  }, 5000);
});

describe('labelFor (service endpoint derivation)', () => {
  const { labelFor } = EXPORTED_FOR_TESTS;
  it.each([
    ['GET', '/api/v1/sentiment/AAPL', '/api/v1/sentiment'],
    ['GET', '/api/v1/company/stripe.com', '/api/v1/company'],
    ['GET', '/api/v1/enrich/email/john@x.com', '/api/v1/enrich/email'],
    ['GET', '/api/v1/news/summary', '/api/v1/news/summary'],
    ['POST', '/api/v1/extract', '/api/v1/extract'],
    ['POST', '/api/v1/analyze/contract', '/api/v1/analyze/contract'],
    ['POST', '/api/v1/review/code', '/api/v1/review/code'],
    ['POST', '/api/v1/research', '/api/v1/research'],
  ])('%s %s → %s', (method, path, expected) => {
    expect(labelFor(method, path)).toBe(expected);
  });

  it('returns the raw path when no rule matches (defence)', () => {
    expect(labelFor('GET', '/not/a/route')).toBe('/not/a/route');
  });
});
