import { describe, it, expect } from 'vitest';
import { estimateAnthropicCostUSD, EXPORTED_FOR_TESTS } from '../src/utils/anthropic-cost';

const { rateFor, MODEL_PRICING } = EXPORTED_FOR_TESTS;

describe('rateFor', () => {
  it('matches haiku by substring', () => {
    expect(rateFor('claude-haiku-4-5-20251001')).toBe(MODEL_PRICING.haiku);
  });
  it('matches opus by substring', () => {
    expect(rateFor('claude-opus-4-7')).toBe(MODEL_PRICING.opus);
  });
  it('matches sonnet by substring', () => {
    expect(rateFor('claude-sonnet-4-6')).toBe(MODEL_PRICING.sonnet);
  });
  it('is case-insensitive', () => {
    expect(rateFor('CLAUDE-HAIKU-4-5')).toBe(MODEL_PRICING.haiku);
  });
  it('defaults unknown slugs to the sonnet rate as a conservative upper bound', () => {
    expect(rateFor('some-unknown-model')).toBe(MODEL_PRICING.sonnet);
  });
});

describe('estimateAnthropicCostUSD', () => {
  it('returns null when usage is missing', () => {
    expect(estimateAnthropicCostUSD('claude-sonnet-4-6', undefined)).toBeNull();
    expect(estimateAnthropicCostUSD('claude-sonnet-4-6', null)).toBeNull();
  });

  it('computes sonnet pricing: $3/MTok in, $15/MTok out', () => {
    const usd = estimateAnthropicCostUSD('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(3 + 15, 6);
  });

  it('computes haiku pricing: $1/MTok in, $5/MTok out', () => {
    const usd = estimateAnthropicCostUSD('claude-haiku-4-5-20251001', {
      input_tokens: 2_000_000,
      output_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(2 + 5, 6);
  });

  it('computes opus pricing: $15/MTok in, $75/MTok out', () => {
    const usd = estimateAnthropicCostUSD('claude-opus-4-7', {
      input_tokens: 100_000,
      output_tokens: 100_000,
    });
    expect(usd).toBeCloseTo(100_000 / 1_000_000 * 15 + 100_000 / 1_000_000 * 75, 6);
  });

  it('includes cache tokens in the input total', () => {
    const usd = estimateAnthropicCostUSD('claude-sonnet-4-6', {
      input_tokens: 500_000,
      cache_creation_input_tokens: 300_000,
      cache_read_input_tokens: 200_000,
      output_tokens: 0,
    });
    // Total input = 1_000_000 tokens × $3/MTok = $3.
    expect(usd).toBeCloseTo(3, 6);
  });

  it('treats null token fields as zero', () => {
    const usd = estimateAnthropicCostUSD('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    });
    expect(usd).toBeCloseTo(3, 6);
  });

  it('returns null when a token count is non-finite', () => {
    const usd = estimateAnthropicCostUSD('claude-sonnet-4-6', {
      input_tokens: Number.POSITIVE_INFINITY,
      output_tokens: 1,
    });
    expect(usd).toBeNull();
  });

  it('is zero for a zero-token response', () => {
    expect(estimateAnthropicCostUSD('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});
