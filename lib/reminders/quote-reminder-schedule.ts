// When estimate and invoice reminders go out. Pure, like
// permit-expiry-schedule.ts, so the rules are unit-tested without a database.
//
// - estimate_expiring: 3 days before the estimate's expiry date.
// - invoice_due_soon: 3 days before the invoice's due date.
// - invoice_overdue: 1 day after the due date.
//
// Each goes out at 15:00 UTC (8am Pacific, 11am Eastern). Unlike the
// permit/licence deadline alerts, a reminder whose time has already passed
// is not scheduled at all: these go to the org's client, who was just sent
// the estimate or invoice, and an immediate "expiring soon"/"overdue" email
// on top of it would read as a mistake. The hourly poller
// (lib/inngest/functions/reminders.ts) re-checks eligibility when each one
// is due, so an accepted estimate or paid invoice is skipped then.

export const ESTIMATE_EXPIRY_REMINDER_LEAD_DAYS = 3;
export const INVOICE_DUE_SOON_LEAD_DAYS = 3;
export const INVOICE_OVERDUE_DELAY_DAYS = 1;
const SEND_HOUR_UTC = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

export type QuoteReminderKind = 'estimate_expiring' | 'invoice_due_soon' | 'invoice_overdue';

export interface PlannedReminder {
  kind: QuoteReminderKind;
  sendAfter: string;
}

function atSendHour(isoDate: string, offsetDays: number): Date {
  const day = new Date(`${isoDate}T00:00:00.000Z`);
  return new Date(day.getTime() + offsetDays * DAY_MS + SEND_HOUR_UTC * 60 * 60 * 1000);
}

function futureOnly(planned: { kind: QuoteReminderKind; at: Date }[], now: Date): PlannedReminder[] {
  return planned.filter((p) => p.at.getTime() > now.getTime()).map((p) => ({ kind: p.kind, sendAfter: p.at.toISOString() }));
}

/** @param expiryDate estimates.expiry_date (`YYYY-MM-DD`), or null. */
export function planEstimateReminders(expiryDate: string | null, now: Date): PlannedReminder[] {
  if (!expiryDate) return [];
  return futureOnly([{ kind: 'estimate_expiring', at: atSendHour(expiryDate, -ESTIMATE_EXPIRY_REMINDER_LEAD_DAYS) }], now);
}

/** @param dueDate invoices.due_date (`YYYY-MM-DD`), or null. */
export function planInvoiceReminders(dueDate: string | null, now: Date): PlannedReminder[] {
  if (!dueDate) return [];
  return futureOnly(
    [
      { kind: 'invoice_due_soon', at: atSendHour(dueDate, -INVOICE_DUE_SOON_LEAD_DAYS) },
      { kind: 'invoice_overdue', at: atSendHour(dueDate, INVOICE_OVERDUE_DELAY_DAYS) },
    ],
    now
  );
}
