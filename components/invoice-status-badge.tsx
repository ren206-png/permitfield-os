// Gate 4 (Quotes & Payments), Phase A UI. Same pattern as
// estimate-status-badge.tsx / components/status-badge.tsx. invoices.status
// is a fixed enum (supabase/migrations/20260806000047_invoices.sql).
type InvoiceStatus = 'draft' | 'issued' | 'void';

const LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  void: 'Void',
};

const CLASSES: Record<InvoiceStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  issued: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const known = status as InvoiceStatus;
  const label = LABELS[known] ?? status;
  const classes = CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
