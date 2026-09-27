import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Gate 4 (Quotes & Payments) -- "estimate expiring" reminder, sent by
// lib/inngest/functions/reminders.ts for `estimate_expiring`-kind
// reminder_jobs. Separate from estimate-sent.ts (which announces a new
// estimate) so a follow-up never reads like a duplicate send. Same
// plain-text-with-minimal-HTML shape as invoice-due-reminder.ts.
export interface EstimateExpiringReminderEmailInput {
  recipientEmail: string;
  recipientName?: string | null;
  organizationName: string;
  /** Public, token-authenticated `${SITE_URL}/estimate/<rawToken>` link --
   * see estimate-sent.ts's viewUrl comment; construction is the caller's
   * concern. */
  viewUrl: string;
  /** Pre-formatted expiry date, or null when there is no upcoming one to
   * mention (none set, or already passed -- the caller decides; this
   * template does no date math, same as invoice-due-reminder.ts). Null
   * switches to "still awaiting your response" wording rather than
   * claiming an expiry. */
  expiresOnDisplay: string | null;
  /** The org's contact email (org_tax_profiles.invoice_contact_email), set
   * as Reply-To. The cron has no sending member, so this is the only place
   * a reply can go; null leaves Reply-To unset. */
  replyToEmail?: string | null;
}

export function renderEstimateExpiringReminderEmail(input: EstimateExpiringReminderEmailInput): RenderedEmail {
  const greetingName = input.recipientName?.trim() || 'there';
  const subject = input.expiresOnDisplay
    ? `Reminder: your estimate from ${input.organizationName} expires on ${input.expiresOnDisplay}`
    : `Reminder: your estimate from ${input.organizationName} is awaiting your response`;

  const statusLine = input.expiresOnDisplay
    ? `This is a reminder that the estimate ${input.organizationName} sent you expires on ${input.expiresOnDisplay}.`
    : `This is a reminder that the estimate ${input.organizationName} sent you is still awaiting your response.`;

  // "Reply to this email" only when a reply actually reaches the org --
  // without a Reply-To it would land at the platform's sender address.
  const closingLine = input.replyToEmail
    ? `If you have already responded, please disregard this reminder. Questions? Reply to this email or contact ${input.organizationName} directly.`
    : `If you have already responded, please disregard this reminder. Questions? Contact ${input.organizationName} directly.`;

  const text = [
    `Hi ${greetingName},`,
    '',
    statusLine,
    'You can review and accept it here:',
    input.viewUrl,
    '',
    closingLine,
  ].join('\n');

  const html = [
    `<p>Hi ${escapeHtml(greetingName)},</p>`,
    `<p>${escapeHtml(statusLine)}</p>`,
    `<p>You can review and accept it here:</p>`,
    `<p><a href="${input.viewUrl}">${escapeHtml(input.viewUrl)}</a></p>`,
    `<p>${escapeHtml(closingLine)}</p>`,
  ].join('\n');

  // Sent as the org, like the "estimate sent" email this follows up on, so
  // both arrive from the same name.
  return {
    to: input.recipientEmail,
    subject,
    text,
    html,
    fromName: input.organizationName,
    ...(input.replyToEmail ? { replyTo: input.replyToEmail } : {}),
  };
}
