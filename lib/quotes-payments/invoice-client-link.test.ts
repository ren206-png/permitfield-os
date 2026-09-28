import { describe, it, expect, vi } from 'vitest';
import type { IssueTargetTokenParams, IssueTargetTokenResult } from '@/lib/bridge/client-portal';
import { evaluateInvoiceClientLinkFlags, issueInvoiceClientLink } from './invoice-client-link';

function fakeIssue(result: IssueTargetTokenResult) {
  return vi.fn(async (params: IssueTargetTokenParams): Promise<IssueTargetTokenResult> => {
    void params;
    return result;
  });
}

const input = { siteUrl: 'https://permitfieldos.com', orgId: 'org-1', invoiceId: 'inv-1', recipientEmail: 'client@example.test', recipientName: 'Client' };

describe('issueInvoiceClientLink()', () => {
  it('issues an invoice token as the system and links to the public invoice page', async () => {
    const issue = fakeIssue({ rawToken: 'raw_TOKEN', tokenId: 'tok-1', expiresAt: '2026-10-10T00:00:00.000Z' });
    const result = await issueInvoiceClientLink(input, issue);
    expect(result).toEqual({ ok: true, viewUrl: 'https://permitfieldos.com/invoice/raw_TOKEN', tokenId: 'tok-1' });
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ targetKind: 'invoice', targetId: 'inv-1', issuedBySystem: true }));
  });

  it('skips when a retry cannot help, and retries on a transient failure', async () => {
    expect(await issueInvoiceClientLink(input, fakeIssue({ error: 'client_portal_disabled' }))).toMatchObject({ ok: false, outcome: 'skipped' });
    expect(await issueInvoiceClientLink(input, fakeIssue({ error: 'target_not_found' }))).toMatchObject({ ok: false, outcome: 'skipped' });
    expect(await issueInvoiceClientLink(input, fakeIssue({ error: 'invalid_recipient_email' }))).toMatchObject({ ok: false, outcome: 'skipped' });
    expect(await issueInvoiceClientLink(input, fakeIssue({ error: 'issue_failed' }))).toMatchObject({ ok: false, outcome: 'send-failed' });
  });
});

describe('evaluateInvoiceClientLinkFlags()', () => {
  it('needs both Quotes & Payments and client portal links', () => {
    expect(evaluateInvoiceClientLinkFlags({ clientPortalEnabled: true, quotesPaymentsEnabled: true })).toBeNull();
    expect(evaluateInvoiceClientLinkFlags({ clientPortalEnabled: false, quotesPaymentsEnabled: true })).toContain('PERMITFIELD_FF_CLIENT_PORTAL');
    expect(evaluateInvoiceClientLinkFlags({ clientPortalEnabled: true, quotesPaymentsEnabled: false })).toContain('PERMITFIELD_FF_QUOTES_PAYMENTS');
  });
});
