import type { IssueTargetTokenParams, IssueTargetTokenResult } from '@/lib/bridge/client-portal';

// The client-facing link an invoice reminder carries: a bearer-token link to
// the public app/invoice/[token] page, never the staff-only `/invoices/<id>`
// page. Invoice sibling of estimate-client-link.ts's issueEstimateClientLink()
// (see that file for the supersede/retry reasoning, which is identical);
// issued as the system, since the hourly reminder cron is its only caller.

export type InvoiceClientLinkResult =
  | { ok: true; viewUrl: string; tokenId: string }
  | { ok: false; outcome: 'skipped'; reason: string }
  | { ok: false; outcome: 'send-failed'; error: string };

/** A reason no invoice link can be issued, or null when both flags are on. */
export function evaluateInvoiceClientLinkFlags(flags: { clientPortalEnabled: boolean; quotesPaymentsEnabled: boolean }): string | null {
  if (!flags.quotesPaymentsEnabled) {
    return 'Quotes & Payments is disabled (PERMITFIELD_FF_QUOTES_PAYMENTS).';
  }
  if (!flags.clientPortalEnabled) {
    return 'Client portal links are disabled (PERMITFIELD_FF_CLIENT_PORTAL), so no client-openable invoice link can be issued.';
  }
  return null;
}

export async function issueInvoiceClientLink(
  input: { siteUrl: string; orgId: string; invoiceId: string; recipientEmail: string; recipientName: string | null },
  issue: (params: IssueTargetTokenParams) => Promise<IssueTargetTokenResult>
): Promise<InvoiceClientLinkResult> {
  const result = await issue({
    targetKind: 'invoice',
    targetId: input.invoiceId,
    orgId: input.orgId,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    issuedBySystem: true,
  });

  if ('error' in result) {
    switch (result.error) {
      case 'client_portal_disabled':
      case 'quotes_payments_disabled':
        return {
          ok: false,
          outcome: 'skipped',
          reason:
            evaluateInvoiceClientLinkFlags({
              clientPortalEnabled: result.error !== 'client_portal_disabled',
              quotesPaymentsEnabled: result.error !== 'quotes_payments_disabled',
            }) ?? result.error,
        };
      case 'target_not_found':
        return { ok: false, outcome: 'skipped', reason: `Invoice ${input.invoiceId} no longer exists.` };
      case 'invalid_recipient_email':
        return { ok: false, outcome: 'skipped', reason: 'Client email on file is not a valid address for a client link.' };
      case 'permit_esign_disabled':
      case 'issue_failed':
        return { ok: false, outcome: 'send-failed', error: `Failed to issue a client invoice link (${result.error}).` };
    }
  }

  return { ok: true, viewUrl: `${input.siteUrl}/invoice/${result.rawToken}`, tokenId: result.tokenId };
}
