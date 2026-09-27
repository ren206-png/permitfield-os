import type { IssueTargetTokenParams, IssueTargetTokenResult, TargetTokenIssuer } from '@/lib/bridge/client-portal';
import type { SendEmailResult } from '@/lib/email/send';
import { renderEstimateSentEmail } from '@/lib/email/templates/estimate-sent';
import type { RenderedEmail } from '@/lib/email/templates/types';

// The client-facing estimate link every client email carries: a bearer-token
// link to the public app/estimate/[token]/page.tsx route, minted by the
// client-portal bridge's issueTargetToken() -- never the staff-only,
// login-protected `/estimates/<id>` page. Two callers:
//   - the "Send estimate" Server Action (app/(app)/estimates/[id]/actions.ts),
//     via emailSentEstimateToClient() below, issuing as the sending member;
//   - the reminder cron (lib/inngest/functions/reminders.ts), via
//     issueEstimateClientLink(), issuing as the system.
//
// Dependency-injected (`issue`/`send` are passed in, not imported) so every
// branch is testable as a plain function with no Inngest, Supabase, Resend,
// or bridge credentials involved. The bridge import above is type-only and
// erased at build time, so this module never loads the bridge itself.

/**
 * Returns a reason when a client link cannot be issued at all, or null when
 * both flags are on. Both are required: issueTargetToken() refuses to mint
 * an estimate token unless the client-portal token mechanism AND the Quotes
 * & Payments feature it points at are enabled (see that module's "Double
 * flag gate" comment), and without a token there is no link a client can
 * actually open.
 */
export function evaluateEstimateClientLinkFlags(flags: {
  clientPortalEnabled: boolean;
  quotesPaymentsEnabled: boolean;
}): string | null {
  if (!flags.quotesPaymentsEnabled) {
    return 'Quotes & Payments is disabled (PERMITFIELD_FF_QUOTES_PAYMENTS).';
  }
  if (!flags.clientPortalEnabled) {
    return 'Client portal links are disabled (PERMITFIELD_FF_CLIENT_PORTAL), so no client-openable estimate link can be issued.';
  }
  return null;
}

export type EstimateClientLinkResult =
  | { ok: true; viewUrl: string; tokenId: string }
  | { ok: false; outcome: 'skipped'; reason: string }
  | { ok: false; outcome: 'send-failed'; error: string };

export type IssueEstimateClientLinkInput = {
  siteUrl: string;
  orgId: string;
  estimateId: string;
  recipientEmail: string;
  recipientName: string | null;
} & TargetTokenIssuer;

/**
 * Mints the token and builds `${siteUrl}/estimate/<rawToken>` -- the same URL
 * shape generateEstimateClientLinkAction() returns. The raw token only ever
 * lives in the returned URL (and so in the email body); it is never logged.
 *
 * The issuer is recorded in token_lifecycle_events: the sending org member
 * for a staff send, or the system (`issuedBySystem: true`) for the reminder
 * cron -- no person took that action, so the ledger should not name one.
 *
 * issueTargetToken() supersedes any active link for the same recipient +
 * estimate, so each new email's link replaces the previous one (the one in
 * an earlier email, or one staff copied from the estimate page). That also
 * keeps reminder retries clean: a job that issued a token but then failed
 * to send is retried next hour, and the new token supersedes the
 * undelivered one.
 *
 * Error mapping: conditions a retry cannot fix (flag flipped off between
 * checks, estimate deleted, unusable recipient email) become 'skipped';
 * 'issue_failed' is a transient bridge/DB failure, so it becomes
 * 'send-failed', which for a reminder leaves the reminder_jobs row pending
 * for the next hourly run instead of giving up on it.
 */
export async function issueEstimateClientLink(
  input: IssueEstimateClientLinkInput,
  issue: (params: IssueTargetTokenParams) => Promise<IssueTargetTokenResult>
): Promise<EstimateClientLinkResult> {
  const issuer: TargetTokenIssuer = input.issuedBySystem
    ? { issuedBySystem: true }
    : { issuedByOrgUserId: input.issuedByOrgUserId };

  const result = await issue({
    targetKind: 'estimate',
    targetId: input.estimateId,
    orgId: input.orgId,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    ...issuer,
  });

  if ('error' in result) {
    switch (result.error) {
      case 'client_portal_disabled':
        return {
          ok: false,
          outcome: 'skipped',
          reason: 'Client portal links are disabled (PERMITFIELD_FF_CLIENT_PORTAL), so no client-openable estimate link can be issued.',
        };
      case 'quotes_payments_disabled':
        return { ok: false, outcome: 'skipped', reason: 'Quotes & Payments is disabled (PERMITFIELD_FF_QUOTES_PAYMENTS).' };
      case 'target_not_found':
        return { ok: false, outcome: 'skipped', reason: `Estimate ${input.estimateId} no longer exists.` };
      case 'invalid_recipient_email':
        return { ok: false, outcome: 'skipped', reason: 'Client email on file is not a valid address for a client link.' };
      case 'permit_esign_disabled':
      case 'issue_failed':
        return { ok: false, outcome: 'send-failed', error: `Failed to issue a client estimate link (${result.error}).` };
    }
  }

  return { ok: true, viewUrl: `${input.siteUrl}/estimate/${result.rawToken}`, tokenId: result.tokenId };
}

export interface EmailSentEstimateInput {
  siteUrl: string;
  orgId: string;
  estimateId: string;
  organizationName: string;
  recipientEmail: string | null;
  recipientName: string | null;
  /** The org member who clicked "Send estimate" -- the link's issuer. */
  sentByOrgUserId: string;
  /** That member's own email, used as Reply-To so the email's "reply to
   * this email" line reaches the contractor, not the platform's sender
   * address. Null leaves Reply-To unset. */
  sentByEmail: string | null;
  clientPortalEnabled: boolean;
  quotesPaymentsEnabled: boolean;
}

export type EmailSentEstimateResult =
  | { status: 'emailed'; recipientEmail: string; viewUrl: string; tokenId: string; messageId: string | null }
  /** Nothing was attempted: a precondition (flag, client email) rules it out. */
  | { status: 'not_emailed'; reason: string }
  /** An attempt failed. `viewUrl` is set when the link itself was issued
   * (only the email failed), so staff can still share it by hand. */
  | { status: 'email_failed'; error: string; viewUrl: string | null; tokenId: string | null };

/**
 * Emails the client a link to an estimate that was just sent. Called only
 * after sendEstimate() succeeded, so the estimate is already `sent` with a
 * revision snapshot for the public route to render. Never throws for an
 * expected failure -- the estimate is sent either way, and the caller
 * reports this outcome alongside that success rather than instead of it.
 */
export async function emailSentEstimateToClient(
  input: EmailSentEstimateInput,
  deps: {
    issue: (params: IssueTargetTokenParams) => Promise<IssueTargetTokenResult>;
    send: (email: RenderedEmail) => Promise<SendEmailResult>;
  }
): Promise<EmailSentEstimateResult> {
  const flagReason = evaluateEstimateClientLinkFlags({
    clientPortalEnabled: input.clientPortalEnabled,
    quotesPaymentsEnabled: input.quotesPaymentsEnabled,
  });
  if (flagReason) {
    return { status: 'not_emailed', reason: flagReason };
  }
  const recipientEmail = input.recipientEmail?.trim();
  if (!recipientEmail) {
    return { status: 'not_emailed', reason: 'This client has no email address on file.' };
  }

  const link = await issueEstimateClientLink(
    {
      siteUrl: input.siteUrl,
      orgId: input.orgId,
      estimateId: input.estimateId,
      recipientEmail,
      recipientName: input.recipientName,
      issuedByOrgUserId: input.sentByOrgUserId,
    },
    deps.issue
  );
  if (!link.ok) {
    return link.outcome === 'skipped'
      ? { status: 'not_emailed', reason: link.reason }
      : { status: 'email_failed', error: link.error, viewUrl: null, tokenId: null };
  }

  const sent = await deps.send(
    renderEstimateSentEmail({
      recipientEmail,
      recipientName: input.recipientName,
      organizationName: input.organizationName,
      viewUrl: link.viewUrl,
      replyToEmail: input.sentByEmail,
    })
  );
  return sent.success
    ? { status: 'emailed', recipientEmail, viewUrl: link.viewUrl, tokenId: link.tokenId, messageId: sent.id }
    : { status: 'email_failed', error: sent.error, viewUrl: link.viewUrl, tokenId: link.tokenId };
}
