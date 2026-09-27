import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Gate 4 (Quotes & Payments), Phase A -- "estimate sent" notification.
// Deliberately plain-text-with-minimal-HTML (this task's own scope, not a
// marketing template): one paragraph plus a single link, nothing else.
export interface EstimateSentEmailInput {
  recipientEmail: string;
  recipientName?: string | null;
  organizationName: string;
  /** Customer-facing "view my quote" link: the public, token-authenticated
   * `${SITE_URL}/estimate/<rawToken>` route (app/estimate/[token]/page.tsx),
   * never the staff-only `/estimates/<id>` page. Minting the token is this
   * template's caller's concern (lib/quotes-payments/estimate-client-link.ts),
   * not this template's. */
  viewUrl: string;
  /** The sending org member's email, set as Reply-To so "reply to this
   * email" reaches the contractor -- same convention as
   * permit-signature-request.ts's requesterEmail. */
  replyToEmail?: string | null;
}

export function renderEstimateSentEmail(input: EstimateSentEmailInput): RenderedEmail {
  const greetingName = input.recipientName?.trim() || 'there';
  const subject = `${input.organizationName} sent you an estimate`;

  const text = [
    `Hi ${greetingName},`,
    '',
    `${input.organizationName} has sent you an estimate. You can view it here:`,
    input.viewUrl,
    '',
    `If you have any questions, please reply to this email or contact ${input.organizationName} directly.`,
  ].join('\n');

  const html = [
    `<p>Hi ${escapeHtml(greetingName)},</p>`,
    `<p>${escapeHtml(input.organizationName)} has sent you an estimate. You can view it here:</p>`,
    `<p><a href="${input.viewUrl}">${escapeHtml(input.viewUrl)}</a></p>`,
    `<p>If you have any questions, please reply to this email or contact ${escapeHtml(input.organizationName)} directly.</p>`,
  ].join('\n');

  return {
    to: input.recipientEmail,
    subject,
    text,
    html,
    fromName: input.organizationName,
    ...(input.replyToEmail ? { replyTo: input.replyToEmail } : {}),
  };
}
