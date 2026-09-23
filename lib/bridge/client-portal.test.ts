import { describe, it, expect } from 'vitest';
import { evaluateIpRateLimit } from './client-portal';

// GATE_5_FINDINGS.md §A.4 follow-up. Pure-function tests, no network/DB --
// same discipline as lib/ai/cost-caps.test.ts's evaluateCostCap() tests,
// for an identical shape of problem (a count compared against a cap). Only
// evaluateIpRateLimit() is exercised here; countRecentDeniedAttemptsForIp()
// is a thin DB-touching wrapper around it and is not unit-tested, same
// "pure core tested, thin DB wrapper not" split cost-caps.ts's own header
// comment describes.

describe('evaluateIpRateLimit()', () => {
  it('allows the attempt when recent denied attempts are below the max', () => {
    expect(evaluateIpRateLimit(0, 20)).toBe(true);
    expect(evaluateIpRateLimit(19, 20)).toBe(true);
  });

  // Deliberately strict `<`, not `<=` -- same reasoning evaluateCostCap's
  // own header comment gives: once the count already equals the max, the
  // *next* attempt is the one that would push over it, so that next
  // attempt is the one this function must reject.
  it('rejects the attempt once recent denied attempts equal the max', () => {
    expect(evaluateIpRateLimit(20, 20)).toBe(false);
  });

  it('rejects the attempt once recent denied attempts exceed the max', () => {
    expect(evaluateIpRateLimit(21, 20)).toBe(false);
  });

  it('rejects a negative recentDeniedAttempts rather than silently treating it as zero', () => {
    expect(() => evaluateIpRateLimit(-1, 20)).toThrow(/nonnegative/);
  });
});
