import { describe, it, expect } from 'vitest';
import { evaluateCostCap } from './cost-caps';

// Gate AI-1, sub-phase AI-1.4. Pure-function tests, no network/DB -- same
// discipline as lib/ai/router.test.ts. Only evaluateCostCap() is exercised
// here; checkOrgMonthlyCostCap()/checkUserDailyCostCap() are thin DB-touching
// wrappers around it and are not unit-tested, same "pure core tested, thin DB
// wrapper not" split the rest of lib/ai/ already draws (e.g.
// lib/ai/estimate-cost.ts's own pure function vs. its DB-touching callers).

describe('evaluateCostCap()', () => {
  it('reports withinCap when current spend is below the cap', () => {
    expect(evaluateCostCap(0, 5_000)).toEqual({
      withinCap: true,
      currentSpendCents: 0,
      capCents: 5_000,
    });
    expect(evaluateCostCap(4_999, 5_000)).toEqual({
      withinCap: true,
      currentSpendCents: 4_999,
      capCents: 5_000,
    });
  });

  // Deliberately strict `<`, not `<=` -- see this function's own header
  // comment. Spend exactly equal to the cap means the next call is the one
  // that would push over it, so it must already report withinCap: false.
  it('reports NOT withinCap once current spend equals the cap', () => {
    expect(evaluateCostCap(5_000, 5_000).withinCap).toBe(false);
  });

  it('reports NOT withinCap once current spend exceeds the cap', () => {
    expect(evaluateCostCap(5_001, 5_000).withinCap).toBe(false);
  });

  it('reports withinCap: true when the cap is zero-spend org and cap is positive', () => {
    const result = evaluateCostCap(0, 500);
    expect(result.withinCap).toBe(true);
    expect(result.capCents).toBe(500);
  });

  it('rejects a negative currentSpendCents rather than silently treating it as zero spend', () => {
    expect(() => evaluateCostCap(-1, 5_000)).toThrow(/nonnegative/);
  });
});
