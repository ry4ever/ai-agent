/**
 * Rough per-call cost estimator for Anthropic API responses.
 *
 * Takes the `usage` object from a `client.messages.create()` response plus the
 * model id, and returns the estimated USD cost of that call. Prices are the
 * public list prices as of 2026-10; update `MODEL_PRICING` when they change.
 *
 * Returns `null` on malformed input — callers should treat missing cost as
 * "unknown" and persist it as `null` in the DB rather than fabricating a zero.
 */

export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** USD per million tokens, (input, output) pairs. */
interface ModelRate {
  input: number;
  output: number;
}

// Anthropic public list pricing (USD per MTok) as of 2026-10.
// Keep this map tight to Claude families; unknown models fall back to Sonnet
// pricing as a conservative upper bound.
const MODEL_PRICING: Record<'opus' | 'sonnet' | 'haiku', ModelRate> = {
  opus:   { input: 15, output: 75 },
  sonnet: { input: 3,  output: 15 },
  haiku:  { input: 1,  output: 5 },
};

function rateFor(model: string): ModelRate {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return MODEL_PRICING.haiku;
  if (m.includes('opus'))  return MODEL_PRICING.opus;
  // Sonnet is the default (also the safest overestimate for unknown model slugs).
  return MODEL_PRICING.sonnet;
}

export function estimateAnthropicCostUSD(model: string, usage: AnthropicUsage | undefined | null): number | null {
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens ?? 0)
    + Number(usage.cache_creation_input_tokens ?? 0)
    + Number(usage.cache_read_input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;

  const rate = rateFor(model);
  const inputUSD = (inputTokens / 1_000_000) * rate.input;
  const outputUSD = (outputTokens / 1_000_000) * rate.output;
  return inputUSD + outputUSD;
}

export const EXPORTED_FOR_TESTS = { rateFor, MODEL_PRICING };
