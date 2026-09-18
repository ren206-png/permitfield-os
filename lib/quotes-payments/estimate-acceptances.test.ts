import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotesPaymentsDisabledError } from './estimates';
import { recordEstimateAcceptance } from './estimate-acceptances';
import { FakeSupabaseClient, dbError, ok } from './test-fakes';

beforeEach(() => {
  process.env.PERMITFIELD_FF_QUOTES_PAYMENTS = 'true';
});
afterEach(() => {
  delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
});

const ORG_ID = 'org-1';
const EXTERNAL_ACTOR = { externalActorId: 'token-1', externalActorLabel: 'jane@client.example' };

const ACCEPTANCE_ROW = {
  id: 'acc-1',
  org_id: ORG_ID,
  estimate_id: 'est-1',
  revision_id: 'rev-1',
  revision_hash: 'deadbeef',
  accepted_scope_snapshot: { scope_notes: 'Install widgets' },
  typed_name: 'Jane Client',
  claimed_authority: 'Owner',
  ip: '203.0.113.7',
  user_agent: 'Mozilla/5.0',
  accepted_at: '2026-09-13T00:00:00.000Z',
};

// This module's trust boundary (see estimate-acceptances.ts's own header
// comment) is that `supabase` is already a service_role client that has
// already validated a client-portal bearer token -- these tests don't (and
// can't) exercise that boundary itself, since it lives entirely outside this
// function; they only verify this wrapper's own behavior given a client that
// (by construction, in a real caller) already satisfies it.
describe('recordEstimateAcceptance()', () => {
  it('throws QuotesPaymentsDisabledError when the flag is off', async () => {
    delete process.env.PERMITFIELD_FF_QUOTES_PAYMENTS;
    const supabase = new FakeSupabaseClient();
    await expect(
      recordEstimateAcceptance(supabase as never, {
        orgId: ORG_ID,
        revisionId: 'rev-1',
        revisionHash: 'deadbeef',
        acceptedScopeSnapshot: {},
        typedName: 'Jane Client',
        claimedAuthority: 'Owner',
        ...EXTERNAL_ACTOR,
      })
    ).rejects.toBeInstanceOf(QuotesPaymentsDisabledError);
  });

  it('calls record_estimate_acceptance and writes an external-actor audit log entry', async () => {
    const supabase = new FakeSupabaseClient({}, { record_estimate_acceptance: [ok(ACCEPTANCE_ROW)] });

    const acceptance = await recordEstimateAcceptance(supabase as never, {
      orgId: ORG_ID,
      revisionId: 'rev-1',
      revisionHash: 'deadbeef',
      acceptedScopeSnapshot: { scope_notes: 'Install widgets' },
      typedName: 'Jane Client',
      claimedAuthority: 'Owner',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      ...EXTERNAL_ACTOR,
    });

    expect(acceptance.id).toBe('acc-1');
    expect(acceptance.estimateId).toBe('est-1');

    const auditCall = supabase.callLog.find((c) => c.table === 'audit_logs');
    expect(auditCall).toBeDefined();
    const insertCall = auditCall?.methodCalls?.find((m) => m.method === 'insert');
    expect(insertCall?.args[0].external_actor_id).toBe('token-1');
    expect(insertCall?.args[0].external_actor_label).toBe('jane@client.example');
    expect(insertCall?.args[0].actor_user_id).toBeNull();
  });

  it('propagates a stale-revision error (errcode 22023) from record_estimate_acceptance rather than swallowing it', async () => {
    const supabase = new FakeSupabaseClient(
      {},
      { record_estimate_acceptance: [dbError('invalid_transition: revision is not the current revision')] }
    );

    await expect(
      recordEstimateAcceptance(supabase as never, {
        orgId: ORG_ID,
        revisionId: 'rev-1',
        revisionHash: 'deadbeef',
        acceptedScopeSnapshot: {},
        typedName: 'Jane Client',
        claimedAuthority: 'Owner',
        ...EXTERNAL_ACTOR,
      })
    ).rejects.toThrow(/invalid_transition/);
  });
});
