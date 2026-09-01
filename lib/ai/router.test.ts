import { describe, it, expect } from 'vitest';
import { routeAiTask } from './router';
import { GEMINI_ASSISTANT_MODEL_ID, GEMINI_CLASSIFICATION_MODEL_ID } from './config';

// Gate AI-1, sub-phase AI-1.1. Pure-function tests, no network/DB -- same
// discipline as lib/entitlements/index.test.ts. Pins down the two contracts
// that actually matter for this router: (1) it rejects 'extraction'/'audit'
// outright (GATE_AI_1_FINDINGS.md question 2's default), and (2) every
// routable kind resolves to a real, deterministic route.

describe('routeAiTask()', () => {
  it('routes assistant to Gemini using the configured assistant model', () => {
    expect(routeAiTask('assistant')).toEqual({
      provider: 'gemini',
      modelId: GEMINI_ASSISTANT_MODEL_ID,
    });
  });

  it('routes classification to Gemini using the configured classification model', () => {
    expect(routeAiTask('classification')).toEqual({
      provider: 'gemini',
      modelId: GEMINI_CLASSIFICATION_MODEL_ID,
    });
  });

  it('routes checklist_generation to Gemini', () => {
    const route = routeAiTask('checklist_generation');
    expect(route.provider).toBe('gemini');
    expect(route.modelId).toBeTruthy();
  });

  // GATE_AI_1_FINDINGS.md question 2's default: the existing Claude call
  // sites (lib/ai/extract-permit-data.ts / lib/ai/audit-permit-data.ts) are
  // not routed through this adapter in this sub-phase. Asserting the
  // rejection, not just "returns something," so a future edit that
  // accidentally wires these up gets a failing test instead of a silent
  // behavior change.
  it('rejects extraction -- not wired to this adapter yet', () => {
    expect(() => routeAiTask('extraction')).toThrow(/not wired/);
  });

  it('rejects audit -- not wired to this adapter yet', () => {
    expect(() => routeAiTask('audit')).toThrow(/not wired/);
  });

  it('rejects an unrecognized task kind rather than guessing a route', () => {
    // @ts-expect-error -- deliberately passing an invalid kind to prove the
    // runtime Zod guard, not just the type system, rejects it.
    expect(() => routeAiTask('not-a-real-kind')).toThrow();
  });
});
