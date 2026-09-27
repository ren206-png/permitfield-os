import { describe, it, expect, vi } from 'vitest';
import type { IssueTargetTokenParams, IssueTargetTokenResult } from '@/lib/bridge/client-portal';
import type { SendEmailResult } from '@/lib/email/send';
import type { RenderedEmail } from '@/lib/email/templates/types';
import {
  emailSentEstimateToClient,
  evaluateEstimateClientLinkFlags,
  issueEstimateClientLink,
} from './estimate-client-link';

// Pure-function tests, no network/DB -- issueTargetToken() and sendEmail()
// are injected as fakes, same discipline as
// lib/inngest/functions/reminder-eligibility.test.ts.

const ISSUED: IssueTargetTokenResult = { rawToken: 'raw_TOKEN-123', tokenId: 'tok-1', expiresAt: '2026-10-10T00:00:00.000Z' };

function fakeIssue(result: IssueTargetTokenResult) {
  return vi.fn(async (params: IssueTargetTokenParams): Promise<IssueTargetTokenResult> => {
    void params;
    return result;
  });
}

function fakeSend(result: SendEmailResult) {
  return vi.fn(async (email: RenderedEmail): Promise<SendEmailResult> => {
    void email;
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

describe('emailSentEstimateToClient()', () => {
  const input = {
    siteUrl: 'https://www.permitfieldos.com',
    orgId: 'org-1',
    estimateId: 'est-1',
    organizationName: 'Acme Permits Inc.',
    recipientEmail: 'client@example.com',
    recipientName: 'Jordan',
    sentByOrgUserId: 'user-1',
    sentByEmail: 'office@acme.example',
    clientPortalEnabled: true,
    quotesPaymentsEnabled: true,
  };

  it('issues a link as the sending member and emails it to the client', async () => {
    const issue = fakeIssue(ISSUED);
    const send = fakeSend({ success: true, id: 'msg-1' });

    const result = await emailSentEstimateToClient(input, { issue, send });

    expect(issue.mock.calls[0][0]).toMatchObject({
      targetKind: 'estimate',
      targetId: 'est-1',
      recipientEmail: 'client@example.com',
      issuedByOrgUserId: 'user-1',
    });
    const email = send.mock.calls[0][0];
    expect(email.to).toBe('client@example.com');
    expect(email.subject).toBe('Acme Permits Inc. sent you an estimate');
    expect(email.text).toContain('https://www.permitfieldos.com/estimate/raw_TOKEN-123');
    expect(email.replyTo).toBe('office@acme.example');
    expect(email.fromName).toBe('Acme Permits Inc.');
    expect(result).toEqual({
      status: 'emailed',
      recipientEmail: 'client@example.com',
      viewUrl: 'https://www.permitfieldos.com/estimate/raw_TOKEN-123',
      tokenId: 'tok-1',
      messageId: 'msg-1',
    });
  });

  it.each([
    [{ clientPortalEnabled: false }, 'PERMITFIELD_FF_CLIENT_PORTAL'],
    [{ quotesPaymentsEnabled: false }, 'PERMITFIELD_FF_QUOTES_PAYMENTS'],
    [{ recipientEmail: null }, 'no email address on file'],
    [{ recipientEmail: '   ' }, 'no email address on file'],
  ])('does not issue a link or email when %o', async (override, reasonFragment) => {
    const issue = fakeIssue(ISSUED);
    const send = fakeSend({ success: true, id: 'msg-1' });

    const result = await emailSentEstimateToClient({ ...input, ...override }, { issue, send });

    expect(issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe('not_emailed');
    expect(result.status === 'not_emailed' && result.reason).toContain(reasonFragment);
  });

  it('reports not_emailed without sending when the bridge rejects the recipient', async () => {
    const send = fakeSend({ success: true, id: 'msg-1' });

    const result = await emailSentEstimateToClient(input, { issue: fakeIssue({ error: 'invalid_recipient_email' }), send });

    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'not_emailed' });
  });

  it('reports email_failed with no link when the link itself could not be issued', async () => {
    const send = fakeSend({ success: true, id: 'msg-1' });

    const result = await emailSentEstimateToClient(input, { issue: fakeIssue({ error: 'issue_failed' }), send });

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'email_failed',
      error: 'Failed to issue a client estimate link (issue_failed).',
      viewUrl: null,
      tokenId: null,
    });
  });

  it('returns the still-valid link when only the email failed, so staff can share it by hand', async () => {
    const result = await emailSentEstimateToClient(input, {
      issue: fakeIssue(ISSUED),
      send: fakeSend({ success: false, error: 'Resend is down.' }),
    });

    expect(result).toEqual({
      status: 'email_failed',
      error: 'Resend is down.',
      viewUrl: 'https://www.permitfieldos.com/estimate/raw_TOKEN-123',
      tokenId: 'tok-1',
    });
  });
});
