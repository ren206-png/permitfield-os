// Gate 4 (Quotes & Payments), Phase B UI. Same pattern as
// invoice-status-badge.tsx / estimate-status-badge.tsx. change_orders.status
// is a fixed enum
// (supabase/migrations/20260806000052_change_orders_and_credit_notes.sql).
type ChangeOrderStatus = 'draft' | 'pending_acceptance' | 'accepted' | 'issued' | 'void';

const LABELS: Record<ChangeOrderStatus, string> = {
  draft: 'Draft',
  pending_acceptance: 'Awaiting acceptance',
  accepted: 'Accepted',
  issued: 'Issued',
  void: 'Void',
};

const CLASSES: Record<ChangeOrderStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  pending_acceptance: 'bg-amber-100 text-amber-700',
  accepted: 'bg-blue-100 text-blue-700',
  issued: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
};

export function ChangeOrderStatusBadge({ status }: { status: string }) {
  const known = status as ChangeOrderStatus;
  const label = LABELS[known] ?? status;
  const classes = CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
