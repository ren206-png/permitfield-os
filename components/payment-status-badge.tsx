// Gate 4 (Quotes & Payments), Phase A UI. Same pattern as
// estimate-status-badge.tsx / invoice-status-badge.tsx. payments.status is a
// fixed enum (supabase/migrations/20260806000049_payments.sql) --
// deliberately just two values, "recorded" and "reversed" (append-only
// correction model, see that migration's header comment: never edited or
// deleted in place).
type PaymentStatus = 'recorded' | 'reversed';

const LABELS: Record<PaymentStatus, string> = {
  recorded: 'Recorded',
  reversed: 'Reversed',
};

const CLASSES: Record<PaymentStatus, string> = {
  recorded: 'bg-green-100 text-green-700',
  reversed: 'bg-zinc-200 text-zinc-700',
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const known = status as PaymentStatus;
  const label = LABELS[known] ?? status;
  const classes = CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
