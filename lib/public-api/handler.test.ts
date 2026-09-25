import { describe, it, expect } from 'vitest';
import { isOverLimit, KEY_RATE_LIMIT_PER_MINUTE } from './handler';

describe('isOverLimit', () => {
  it('allows requests below the cap and blocks at or above it', () => {
    expect(isOverLimit(0, KEY_RATE_LIMIT_PER_MINUTE)).toBe(false);
    expect(isOverLimit(KEY_RATE_LIMIT_PER_MINUTE - 1, KEY_RATE_LIMIT_PER_MINUTE)).toBe(false);
    expect(isOverLimit(KEY_RATE_LIMIT_PER_MINUTE, KEY_RATE_LIMIT_PER_MINUTE)).toBe(true);
    expect(isOverLimit(KEY_RATE_LIMIT_PER_MINUTE + 5, KEY_RATE_LIMIT_PER_MINUTE)).toBe(true);
  });
});
