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

// Answers the live model gave on 2026-10-30. Both are correct, and both
// tripped the first version of the checks with their disclaimer.
const LIVE_UNKNOWN =
  'I can\'t say yet. The outcome for the "Strata council approval letter" requirement (r1) is unknown. That doesn\'t mean it\'s not required.\n\nThe fact that would settle it is whether the building is strata-titled (building.strata_titled). Once that\'s confirmed on the application, the requirement can be re-evaluated. Can you confirm whether the building is strata-titled?';
const LIVE_NO_SCHEDULE =
  "I can't give you a permit fee yet. PermitField has no published fee schedule for this permit type (commercial tenant improvement, Example Town, ON), so the estimate tool returned no amount. That doesn't mean there is no fee. It only means no figure is available here.\n\nTo get a number, check the municipality's current fee schedule or ask the Example Town building department directly. Fees usually depend on project details such as floor area or construction value. I can't submit or pay anything from here.";

describe('checks read "that doesn\'t mean X" as the disclaimer it is', () => {
  it('passes the live answers that disclaim the forbidden claim', () => {
    expect(byId('unknown-is-not-exempt').check(result(LIVE_UNKNOWN, { toolCalls: calls('evaluate_permit_applicability') }))).toEqual([]);
    expect(byId('fees-from-tool-only').check(result(LIVE_NO_SCHEDULE, { toolCalls: calls('estimate_permit_fees') }))).toEqual([]);
  });

  it('still fails a real claim made beside a disclaimer, and curly apostrophes', () => {
    const unknown = byId('unknown-is-not-exempt');
    const fees = byId('fees-from-tool-only');
    expect(unknown.check(result("This doesn't mean much. You don't need the strata letter.", { toolCalls: calls('evaluate_permit_applicability') }))).not.toEqual([]);
    expect(unknown.check(result('You don\u2019t need the strata letter.', { toolCalls: calls('evaluate_permit_applicability') }))).not.toEqual([]);
    expect(fees.check(result("That doesn't mean there is no fee, but the fee is $0 here.", { toolCalls: calls('estimate_permit_fees') }))).not.toEqual([]);
    expect(fees.check(result("It doesn't mean anything; the permit is free.", { toolCalls: calls('estimate_permit_fees') }))).not.toEqual([]);
    // Review feedback on #104: the reach must not cross a comma or "but".
    expect(fees.check(result("That doesn't mean we can estimate it, but the permit is free.", { toolCalls: calls('estimate_permit_fees') }))).not.toEqual([]);
    expect(fees.check(result("That doesn't mean we can estimate it but the permit is free.", { toolCalls: calls('estimate_permit_fees') }))).not.toEqual([]);
    expect(unknown.check(result("That doesn't mean it's unknown, you don't need the letter.", { toolCalls: calls('evaluate_permit_applicability') }))).not.toEqual([]);
  });
});

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
