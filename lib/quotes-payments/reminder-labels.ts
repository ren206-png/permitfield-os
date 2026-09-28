// Gate 4 (Quotes & Payments) UX polish. Shared label map for
// reminder_jobs.kind (supabase/migrations/20260806000057_reminder_jobs.sql)
// -- pulled out to its own file, unlike the status-badge components' own
// per-file literal unions, because this map is read from two different
// detail pages (app/(app)/estimates/[id]/page.tsx and
// app/(app)/invoices/[id]/page.tsx) rather than one, so keeping it in one
// place avoids the two call sites silently drifting apart if a kind is
// ever renamed.
//
// Jobs are created when an estimate is sent and when an invoice is issued
// (lib/reminders/quote-reminder-schedule.ts, via the send/issue Server
// Actions), so these labels now describe real scheduled reminders.
export type ReminderJobKind = 'estimate_expiring' | 'invoice_due_soon' | 'invoice_overdue';

export const REMINDER_KIND_LABELS: Record<ReminderJobKind, string> = {
  estimate_expiring: 'Estimate expiring',
  invoice_due_soon: 'Invoice due soon',
  invoice_overdue: 'Invoice overdue',
};

export function reminderKindLabel(kind: string): string {
  return REMINDER_KIND_LABELS[kind as ReminderJobKind] ?? kind;
}
