// Gate 4 (Quotes & Payments) UX polish. Shared label map for
// reminder_jobs.kind (supabase/migrations/20260806000057_reminder_jobs.sql)
// -- pulled out to its own file, unlike the status-badge components' own
// per-file literal unions, because this map is read from two different
// detail pages (app/(app)/estimates/[id]/page.tsx and
// app/(app)/invoices/[id]/page.tsx) rather than one, so keeping it in one
// place avoids the two call sites silently drifting apart if a kind is
// ever renamed.
//
// Note for whoever picks up reminder-job creation next: as of this pass,
// nothing in the codebase ever INSERTs a reminder_jobs row (confirmed by
// lib/inngest/functions/reminders.ts's own header comment, "no
// job-creation call site exists yet") -- the poller and this UI can both
// read the table, but it will show "No reminders scheduled" in every org
// until a creation call site (e.g. on send_estimate()/issue_invoice()) is
// added separately. This file and the detail-page UI it feeds are read-side
// only; they don't paper over that gap.
export type ReminderJobKind = 'estimate_expiring' | 'invoice_due_soon' | 'invoice_overdue';

export const REMINDER_KIND_LABELS: Record<ReminderJobKind, string> = {
  estimate_expiring: 'Estimate expiring',
  invoice_due_soon: 'Invoice due soon',
  invoice_overdue: 'Invoice overdue',
};

export function reminderKindLabel(kind: string): string {
  return REMINDER_KIND_LABELS[kind as ReminderJobKind] ?? kind;
}
