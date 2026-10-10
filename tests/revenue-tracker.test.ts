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

import { trackRevenue, extractTxHash, extractAgentAddress } from '../src/payments/revenue-tracker';
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

  it('calls next() after the writes settle', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '2000');
    await middleware(mockReq(), mockRes(), next);
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

  it('derives agent address from the signed X-PAYMENT payload (not a client header)', async () => {
    // The EIP-3009 payload the facilitator has already verified. If the server
    // trusts the client-supplied x-agent-address header, an attacker can set it
    // to anything; the signed authorization.from field is the only authentic
    // signer identity.
    const signer = '0xAbCdEf0123456789abcdef0123456789aBcDeF01';
    const header = Buffer
      .from(JSON.stringify({
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        payload: {
          signature: '0xdeadbeef',
          authorization: {
            from: signer,
            to: '0x1111111111111111111111111111111111111111',
            value: '2000',
            validAfter: '0',
            validBefore: '99999999',
            nonce: '0x' + '0'.repeat(64),
          },
        },
      }))
      .toString('base64');

    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '2000');
    middleware(
      mockReq({ 'x-payment': header, 'x-agent-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      mockRes(),
      next,
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_address: signer.toLowerCase(),
      }),
    );
  });

  it('does not throw when DB writes fail (error is caught)', async () => {
    vi.mocked(insertTransaction).mockRejectedValueOnce(new Error('DB down'));
    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '1000');

    await expect(middleware(mockReq(), mockRes(), next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('releases next() after DB_WRITE_TIMEOUT_MS even when writes hang', async () => {
    // Simulate a hung DB: a promise that never resolves.
    vi.mocked(insertTransaction).mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(upsertDailyRevenue).mockImplementationOnce(() => new Promise(() => {}));

    const next = vi.fn() as unknown as NextFunction;
    const middleware = trackRevenue('/api/v1/test', '1000');

    const start = Date.now();
    await middleware(mockReq(), mockRes(), next);
    const elapsed = Date.now() - start;

    expect(next).toHaveBeenCalled();
    // 2s timeout — generous bound either side for CI variance
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(3500);
  }, 5000);

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

describe('extractAgentAddress', () => {
  const EVM_ADDR = '0xAbCdEf0123456789abcdef0123456789aBcDeF01';

  function b64(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
  }

  it('reads payload.authorization.from (EIP-3009 shape) and lowercases it', () => {
    const header = b64({
      x402Version: 1,
      scheme: 'exact',
      network: 'base-mainnet',
      payload: {
        signature: '0xdeadbeef',
        authorization: {
          from: EVM_ADDR,
          to: '0x1111111111111111111111111111111111111111',
          value: '1000',
          validAfter: '0',
          validBefore: '99999999',
          nonce: '0x' + '0'.repeat(64),
        },
      },
    });
    expect(extractAgentAddress(header)).toBe(EVM_ADDR.toLowerCase());
  });

  it('falls back to a nested `from` field if the EIP-3009 shape is missing', () => {
    // Some future scheme or wrapped payload: a `from` lives somewhere else.
    const header = b64({ payload: { signer: { from: EVM_ADDR } } });
    expect(extractAgentAddress(header)).toBe(EVM_ADDR.toLowerCase());
  });

  it('returns null when no 20-byte-hex `from` field is present', () => {
    const header = b64({ x402Version: 1, scheme: 'exact', network: 'base-sepolia' });
    expect(extractAgentAddress(header)).toBeNull();
  });

  it('rejects a `from` field that is not a valid EVM address', () => {
    const header = b64({ payload: { authorization: { from: '0xNOTANADDRESS' } } });
    expect(extractAgentAddress(header)).toBeNull();
  });

  it('returns null for a non-JSON header rather than throwing', () => {
    expect(extractAgentAddress(Buffer.from('garbage').toString('base64'))).toBeNull();
  });
});
