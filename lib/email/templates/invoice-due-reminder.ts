import { escapeHtml } from './escape-html';
import type { RenderedEmail } from './types';

// Gate 4 (Quotes & Payments), Phase A -- "invoice due" / "invoice
// overdue" reminder. One template covers both cases (`overdue` flag)
// rather than two near-duplicate files, since the only difference is
// wording, not structure -- lib/inngest/functions/reminders.ts picks the
// subject/body variant by passing `overdue: true` for
// `invoice_overdue`-kind reminder_jobs and `false` for
// `invoice_due_soon`-kind ones.
export interface InvoiceDueReminderEmailInput {
  recipientEmail: string;
  recipientName?: string | null;
  organizationName: string;
  /** Customer-facing "view my invoice" link -- construction is this
   * template's caller's concern, same as estimate-sent.ts's viewUrl. */
  viewUrl: string;
  /** Org-scoped invoice_number (issue_invoice() assigns it) -- omitted
   * when not yet known to the caller, though in practice every
   * reminder_job this template renders for targets an issued invoice. */
  invoiceNumber?: number | string | null;
  /** Pre-formatted due-date string (this template does no date math or
   * locale formatting itself -- the caller owns that). */
  dueDateDisplay: string;
  overdue: boolean;
}

export function renderInvoiceDueReminderEmail(input: InvoiceDueReminderEmailInput): RenderedEmail {
  const greetingName = input.recipientName?.trim() || 'there';
  const invoiceLabel = input.invoiceNumber != null ? `invoice #${input.invoiceNumber}` : 'your invoice';
  const subject = input.overdue
    ? `Overdue: ${invoiceLabel} from ${input.organizationName}`
    : `Reminder: ${invoiceLabel} from ${input.organizationName} is due soon`;

  const statusLine = input.overdue
    ? `${invoiceLabel} from ${input.organizationName} was due on ${input.dueDateDisplay} and is now overdue.`
    : `${invoiceLabel} from ${input.organizationName} is due on ${input.dueDateDisplay}.`;

  const text = [
    `Hi ${greetingName},`,
    '',
    statusLine,
    'You can view and pay it here:',
    input.viewUrl,
    '',
    `If you have already paid, please disregard this reminder. Questions? Reply to this email or contact ${input.organizationName} directly.`,
  ].join('\n');

  const html = [
    `<p>Hi ${escapeHtml(greetingName)},</p>`,
    `<p>${escapeHtml(statusLine)}</p>`,
    `<p>You can view and pay it here:</p>`,
    `<p><a href="${input.viewUrl}">${escapeHtml(input.viewUrl)}</a></p>`,
    `<p>If you have already paid, please disregard this reminder. Questions? Reply to this email or contact ${escapeHtml(input.organizationName)} directly.</p>`,
  ].join('\n');

  return { to: input.recipientEmail, subject, text, html };
}
