import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Gate 4 (Quotes & Payments), Phase A -- "estimate sent" notification.
// Deliberately plain-text-with-minimal-HTML (this task's own scope, not a
// marketing template): one paragraph plus a single link, nothing else.
export interface EstimateSentEmailInput {
  recipientEmail: string;
  recipientName?: string | null;
  organizationName: string;
  /** Customer-facing "view my quote" link -- see send_estimate()'s own
   * header comment (20260806000045_estimates.sql) for what this points at;
   * construction of the actual URL is this template's caller's concern,
   * not this template's. */
  viewUrl: string;
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

  return { to: input.recipientEmail, subject, text, html };
}
