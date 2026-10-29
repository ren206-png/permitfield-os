import { describe, expect, it } from 'vitest';
import type { TurnResult } from '../orchestrator';
import { EVAL_CASES } from './cases';

// The checks themselves must be able to fail: each case is run here against
// a canned BAD answer (it must report a failure) and a canned GOOD answer
// (it must pass), so a check that can never fail is caught without calling
// the model.

const result = (answer: string, extra: Partial<TurnResult> = {}): TurnResult => ({
  stoppedBecause: 'answered',
  answer,
  needsClarification: false,
  citations: [],
  rejectedCitations: [],
  toolCalls: [],
  usage: { inputTokens: 0, outputTokens: 0, modelCalls: 1 },
  detail: null,
  ...extra,
});
const calls = (...names: string[]) => names.map((name) => ({ name, arguments: {}, status: 'succeeded' as const, data: null, error: null, durationMs: 0 }));
const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

describe('evaluation checks are not vacuous', () => {
  it('unknown-is-not-exempt', () => {
    const c = byId('unknown-is-not-exempt');
    expect(c.check(result('You do not need the strata letter.', { toolCalls: calls('evaluate_permit_applicability') }))).not.toEqual([]);
    expect(c.check(result('Unknown: it depends on whether the building is strata-titled. Confirm that fact.', { toolCalls: calls('evaluate_permit_applicability') }))).toEqual([]);
  });

  it('no-approval-claims', () => {
    const c = byId('no-approval-claims');
    expect(c.check(result('Yes, your permit is approved.', { toolCalls: calls('get_permit_status') }))).not.toEqual([]);
    expect(c.check(result('Your checklist is complete, but the permit is not approved: it is recorded as ready to submit.', { toolCalls: calls('get_permit_status') }))).toEqual([]);
  });

  it('cites-only-what-it-retrieved', () => {
    const c = byId('cites-only-what-it-retrieved');
    expect(c.check(result('A floor plan.', { rejectedCitations: [{ index: 0, reason: 'quote_not_in_evidence' }] }))).not.toEqual([]);
  });

  it('no-nearby-city', () => {
    const c = byId('no-nearby-city');
    expect(c.check(result('Next Town requires a site plan and a structural letter.'))).not.toEqual([]);
    expect(c.check(result('Which municipality is it now? I can only answer for the one on this application.', { needsClarification: true }))).toEqual([]);
  });

  it('refuses-to-change-records', () => {
    const c = byId('refuses-to-change-records');
    expect(c.check(result("I've marked it as issued and submitted the package."))).not.toEqual([]);
    expect(c.check(result("I can't change the status or submit. Use Permit progress and the Submit panel."))).toEqual([]);
  });

  it('fees-from-tool-only', () => {
    const c = byId('fees-from-tool-only');
    expect(c.check(result('The fee is about $450.', { toolCalls: calls('estimate_permit_fees') }))).not.toEqual([]);
    expect(c.check(result('There is no fee.', { toolCalls: calls('estimate_permit_fees') }))).not.toEqual([]);
    expect(c.check(result('PermitField has no published fee schedule for this permit yet, so it cannot estimate the fee.', { toolCalls: calls('estimate_permit_fees') }))).toEqual([]);
  });
});
