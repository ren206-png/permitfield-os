import { describe, it, expect } from 'vitest';
import { checkApprovalPromiseLanguage } from './approval-promise';

// Gate AI-1, sub-phase AI-1.1 (GATE_AI_1_FINDINGS.md §H, APPROVAL_PROMISE).
// Exact-example tests, matching this guard's own header comment's claim of
// being "auditable and testable by exact example" rather than fuzzy.

describe('checkApprovalPromiseLanguage()', () => {
  it('flags a direct approval-promise sentence', () => {
    const result = checkApprovalPromiseLanguage('Based on these documents, your permit will be approved.');
    expect(result.matched).toBe(true);
    expect(result.matchedPhrases).toContain('will be approved');
  });

  it('flags "guaranteed" language', () => {
    const result = checkApprovalPromiseLanguage('This is a guaranteed approval given the scope described.');
    expect(result.matched).toBe(true);
    expect(result.matchedPhrases).toContain('guaranteed approval');
  });

  it('is case-insensitive', () => {
    const result = checkApprovalPromiseLanguage('YOU ARE APPROVED for this permit.');
    expect(result.matched).toBe(true);
    expect(result.matchedPhrases).toContain('you are approved');
  });

  it('can match more than one phrase in the same text', () => {
    const result = checkApprovalPromiseLanguage(
      'This is a guaranteed approval -- your permit will be approved.'
    );
    expect(result.matchedPhrases.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a hedged, non-promissory sentence', () => {
    const result = checkApprovalPromiseLanguage(
      'The extracted facts appear consistent with the excerpt shown, but this is not a compliance determination.'
    );
    expect(result.matched).toBe(false);
    expect(result.matchedPhrases).toEqual([]);
  });

  it('does not flag an empty string', () => {
    const result = checkApprovalPromiseLanguage('');
    expect(result.matched).toBe(false);
  });
});
