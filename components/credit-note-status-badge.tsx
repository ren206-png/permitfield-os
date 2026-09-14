// Gate 4 (Quotes & Payments), Phase B UI. Same pattern as
// invoice-status-badge.tsx. credit_notes.status is a fixed enum
// (supabase/migrations/20260806000052_change_orders_and_credit_notes.sql).
type CreditNoteStatus = 'draft' | 'issued' | 'void';

const LABELS: Record<CreditNoteStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  void: 'Void',
};

const CLASSES: Record<CreditNoteStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  issued: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
};

export function CreditNoteStatusBadge({ status }: { status: string }) {
  const known = status as CreditNoteStatus;
  const label = LABELS[known] ?? status;
  const classes = CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
