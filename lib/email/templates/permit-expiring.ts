import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Deadline/expiry alerts, slice 2 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up). Sibling to contractor-license-expiring.ts, same rationale:
// internal/staff-facing (broadcast to org members via
// lib/notifications/recipients.ts's resolveOrgNotificationRecipients()),
// not client-facing -- a permit's expiry is the org's own compliance
// concern, not something this codebase has ever emailed a client about.
// `overdue` is computed live by the caller (comparing permitExpiresOn to
// "now" at fire time), same single-kind-covers-both-cases design as the
// contractor template's own header comment explains.
export interface PermitExpiringEmailInput {
  recipientEmail: string;
  organizationName: string;
  projectTitle: string;
  projectAddress: string;
  /** Pre-formatted date string -- this template does no date math or
   * locale formatting itself, same convention as
   * contractor-license-expiring.ts's expiresOnDisplay. */
  expiresOnDisplay: string;
  overdue: boolean;
}

export function renderPermitExpiringEmail(input: PermitExpiringEmailInput): RenderedEmail {
  const subject = input.overdue
    ? `Permit expired: ${input.projectTitle}`
    : `Permit expiring soon: ${input.projectTitle}`;

  const statusLine = input.overdue
    ? `The permit for "${input.projectTitle}" (${input.projectAddress}) on file with ${input.organizationName} expired on ${input.expiresOnDisplay}.`
    : `The permit for "${input.projectTitle}" (${input.projectAddress}) on file with ${input.organizationName} expires on ${input.expiresOnDisplay}.`;

  const text = [
    'Hi there,',
    '',
    statusLine,
    'Continuing work under an expired permit may violate local building code -- please confirm whether renewal or a new filing is needed and update the record in PermitField OS.',
  ].join('\n');

  const html = [
    `<p>Hi there,</p>`,
    `<p>${escapeHtml(statusLine)}</p>`,
    `<p>Continuing work under an expired permit may violate local building code -- please confirm whether renewal or a new filing is needed and update the record in PermitField OS.</p>`,
  ].join('\n');

  return { to: input.recipientEmail, subject, text, html };
}
