// Gate 4 (Quotes & Payments) UX polish. Same Record<Status,string>
// label/class-map pattern as components/estimate-status-badge.tsx /
// invoice-status-badge.tsx / payment-status-badge.tsx -- reminder_jobs.status
// is a fixed enum (supabase/migrations/20260806000050_reminder_jobs.sql).
type ReminderJobStatus = 'pending' | 'sent' | 'skipped' | 'canceled';

const LABELS: Record<ReminderJobStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  skipped: 'Skipped',
  canceled: 'Canceled',
};

const CLASSES: Record<ReminderJobStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  skipped: 'bg-zinc-100 text-zinc-700',
  canceled: 'bg-zinc-200 text-zinc-500',
};

export function ReminderJobStatusBadge({ status }: { status: string }) {
  const known = status as ReminderJobStatus;
  const label = LABELS[known] ?? status;
  const classes = CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
