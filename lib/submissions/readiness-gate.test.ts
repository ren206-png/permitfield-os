import { describe, it, expect } from 'vitest';
import { submissionBlockedByReadiness } from './readiness-gate';

describe('submissionBlockedByReadiness()', () => {
  it('blocks submitting before Ready to submit when readiness is on', () => {
    expect(submissionBlockedByReadiness('intake', true)).toMatch(/Ready to submit/);
    expect(submissionBlockedByReadiness('internal_review', true)).toMatch(/Ready to submit/);
    expect(submissionBlockedByReadiness(null, true)).toMatch(/Ready to submit/);
  });

  it('allows Ready to submit and later statuses (second filing, revisions)', () => {
    for (const status of ['ready_to_submit', 'submitted', 'under_municipal_review', 'revision_requested', 'resubmitted']) {
      expect(submissionBlockedByReadiness(status, true)).toBeNull();
    }
  });

  it('does not gate at all when readiness tracking is off', () => {
    expect(submissionBlockedByReadiness('intake', false)).toBeNull();
  });
});
