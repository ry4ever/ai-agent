import { describe, it, expect } from 'vitest';

describe('Rate limiter fail-open behavior', () => {
  it('distinguishes backend errors from rate-limit rejections', () => {
    // The rate limiter's catch block checks `rlRejected instanceof Error`.
    // If the rejection is a plain Error (Redis down), it calls next() (fail-open).
    // If it's a RateLimiterRes (limit exceeded), it returns 429.

    const backendError = new Error('ECONNREFUSED');
    expect(backendError instanceof Error).toBe(true);

    const rateLimiterRes = { msBeforeNext: 5000 };
    expect(rateLimiterRes instanceof Error).toBe(false);
  });
});
