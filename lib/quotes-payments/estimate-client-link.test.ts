import { describe, it, expect, vi } from 'vitest';
import type { IssueTargetTokenParams, IssueTargetTokenResult } from '@/lib/bridge/client-portal';
import { evaluateEstimateClientLinkFlags, issueEstimateClientLink } from './estimate-client-link';

// Pure-function tests, no network/DB -- issueTargetToken() is injected as a
// fake, same discipline as lib/inngest/functions/reminder-eligibility.test.ts.

const ISSUED: IssueTargetTokenResult = { rawToken: 'raw_TOKEN-123', tokenId: 'tok-1', expiresAt: '2026-10-10T00:00:00.000Z' };

function fakeIssue(result: IssueTargetTokenResult) {
  return vi.fn(async (params: IssueTargetTokenParams): Promise<IssueTargetTokenResult> => {
    void params;
    return result;
  });
}

describe('evaluateEstimateClientLinkFlags()', () => {
  it('allows the link when both flags are on', () => {
    expect(evaluateEstimateClientLinkFlags({ clientPortalEnabled: true, quotesPaymentsEnabled: true })).toBeNull();
  });

  it('gives a quotes-payments reason when that flag is off', () => {
    expect(evaluateEstimateClientLinkFlags({ clientPortalEnabled: true, quotesPaymentsEnabled: false })).toContain(
      'PERMITFIELD_FF_QUOTES_PAYMENTS'
    );
  });

  it('gives a client-portal reason when that flag is off', () => {
    expect(evaluateEstimateClientLinkFlags({ clientPortalEnabled: false, quotesPaymentsEnabled: true })).toContain(
      'PERMITFIELD_FF_CLIENT_PORTAL'
    );
  });

  it('reports quotes-payments first when both flags are off', () => {
    expect(evaluateEstimateClientLinkFlags({ clientPortalEnabled: false, quotesPaymentsEnabled: false })).toContain(
      'PERMITFIELD_FF_QUOTES_PAYMENTS'
    );
  });
});

describe('issueEstimateClientLink()', () => {
  const input = {
    siteUrl: 'https://www.permitfieldos.com',
    orgId: 'org-1',
    estimateId: 'est-1',
    recipientEmail: 'client@example.com',
    recipientName: 'Jordan',
  };

  it('issues as the system and builds the public /estimate/<token> URL', async () => {
    const issue = fakeIssue(ISSUED);

    const result = await issueEstimateClientLink({ ...input, issuedBySystem: true }, issue);

    expect(issue).toHaveBeenCalledWith({
      targetKind: 'estimate',
      targetId: 'est-1',
      orgId: 'org-1',
      recipientEmail: 'client@example.com',
      recipientName: 'Jordan',
      issuedBySystem: true,
    });
    expect(result).toEqual({
      ok: true,
      viewUrl: 'https://www.permitfieldos.com/estimate/raw_TOKEN-123',
      tokenId: 'tok-1',
    });
  });

  it('issues as an org member when one is given, and not as the system', async () => {
    const issue = fakeIssue(ISSUED);

    await issueEstimateClientLink({ ...input, issuedByOrgUserId: 'user-1' }, issue);

    const params = issue.mock.calls[0][0];
    expect(params.issuedByOrgUserId).toBe('user-1');
    expect(params.issuedBySystem).toBeUndefined();
  });

  it('never points at the staff-only /estimates/<id> page', async () => {
    const result = await issueEstimateClientLink({ ...input, issuedBySystem: true }, fakeIssue(ISSUED));

    expect(result.ok && result.viewUrl).not.toContain('/estimates/');
    expect(result.ok && result.viewUrl).not.toContain('est-1');
  });

  it.each([
    ['client_portal_disabled', 'PERMITFIELD_FF_CLIENT_PORTAL'],
    ['quotes_payments_disabled', 'PERMITFIELD_FF_QUOTES_PAYMENTS'],
    ['target_not_found', 'no longer exists'],
    ['invalid_recipient_email', 'not a valid address'],
  ] as const)('skips (terminal) on %s', async (error, reasonFragment) => {
    const result = await issueEstimateClientLink({ ...input, issuedBySystem: true }, fakeIssue({ error }));

    expect(result).toMatchObject({ ok: false, outcome: 'skipped' });
    expect(!result.ok && result.outcome === 'skipped' && result.reason).toContain(reasonFragment);
  });

  it.each(['issue_failed', 'permit_esign_disabled'] as const)(
    'reports %s as send-failed so a reminder job stays pending and retries',
    async (error) => {
      const result = await issueEstimateClientLink({ ...input, issuedBySystem: true }, fakeIssue({ error }));

      expect(result).toEqual({
        ok: false,
        outcome: 'send-failed',
        error: `Failed to issue a client estimate link (${error}).`,
      });
    }
  );
});
