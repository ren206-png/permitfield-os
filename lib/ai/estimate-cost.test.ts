import { describe, expect, it } from 'vitest';
import { estimateCostUsdCents } from './estimate-cost';
import { inputTokensOf, type ProviderMessage } from './copilot/provider';

describe('estimateCostUsdCents (Gate 6.7)', () => {
  it('uses the model’s own rates when known', () => {
    // 1M in + 100k out on Sonnet 5.5: $2 + $1 = 300 c
    expect(estimateCostUsdCents(1_000_000, 100_000, 'claude-sonnet-5-5')).toBe(300);
    expect(estimateCostUsdCents(1_000_000, 100_000, 'claude-haiku-5-5')).toBe(15);
  });

  it('an unknown model falls back to the higher placeholder rates (over-, never under-counted)', () => {
    const unknown = estimateCostUsdCents(1_000_000, 100_000, 'some-new-model');
    expect(unknown).toBe(estimateCostUsdCents(1_000_000, 100_000));
    expect(unknown).toBeGreaterThan(estimateCostUsdCents(1_000_000, 100_000, 'claude-sonnet-5-5'));
  });

  it('prompt-cache reads and writes count as input tokens', () => {
    const usage = { input_tokens: 100, output_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 8000 } as ProviderMessage['usage'];
    expect(inputTokensOf(usage)).toBe(10_100);
    expect(inputTokensOf({ input_tokens: 100, output_tokens: 5 } as ProviderMessage['usage'])).toBe(100);
  });
});
