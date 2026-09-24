import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Deadline/expiry alerts, slice 1 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up). Internal/staff-facing, unlike estimate-sent.ts/
// invoice-due-reminder.ts (which email the contractor's own client) --
// there is no client involved in a contractor's own license, so this
// renders once per org-notification recipient
// (lib/notifications/recipients.ts's resolveOrgNotificationRecipients()),
// not once per external contact. See
// lib/inngest/functions/reminders.ts's 'contractor' branch for why a
// single job can render (and attempt to send) this more than once.
//
// `overdue` is computed live by the caller (comparing licenseExpiresOn to
// "now" at fire time), not derived from reminder_jobs.kind -- there is
// only one kind ('contractor_license_expiring') covering both the
// upcoming and already-past cases, unlike invoice_due_soon/
// invoice_overdue's two-kind split, since re-deriving live is this
// codebase's own stated preference (reminder-eligibility.ts's header
// comment) over trusting a kind chosen once at job-creation time.
export interface ContractorLicenseExpiringEmailInput {
  recipientEmail: string;
  organizationName: string;
  contractorCompanyName: string;
  /** Pre-formatted date string (this template does no date math or
   * locale formatting itself, same convention as invoice-due-reminder.ts's
   * dueDateDisplay). */
  expiresOnDisplay: string;
  overdue: boolean;
}

export function renderContractorLicenseExpiringEmail(input: ContractorLicenseExpiringEmailInput): RenderedEmail {
  const subject = input.overdue
    ? `License expired: ${input.contractorCompanyName}`
    : `License expiring soon: ${input.contractorCompanyName}`;

  const statusLine = input.overdue
    ? `${input.contractorCompanyName}'s license on file with ${input.organizationName} expired on ${input.expiresOnDisplay}.`
    : `${input.contractorCompanyName}'s license on file with ${input.organizationName} expires on ${input.expiresOnDisplay}.`;

  const text = [
    'Hi there,',
    '',
    statusLine,
    'Filing a permit application with an expired contractor license may cause the application to be rejected -- please confirm the license has been renewed and update the record in PermitField OS.',
  ].join('\n');

  const html = [
    `<p>Hi there,</p>`,
    `<p>${escapeHtml(statusLine)}</p>`,
    `<p>Filing a permit application with an expired contractor license may cause the application to be rejected -- please confirm the license has been renewed and update the record in PermitField OS.</p>`,
  ].join('\n');

  return { to: input.recipientEmail, subject, text, html };
}
