// Gate 4 (Quotes & Payments), Phase A UI. Mirrors components/status-badge.tsx's
// exact shape (Record<Status, string> label map + Record<Status, string>
// class map, unknown values fall back to a neutral style + the raw string)
// -- the only existing badge pattern in this codebase, see that file's own
// header comment. estimates.status is a fixed enum
// (supabase/migrations/20260806000052_estimates.sql), kept as a literal
// union here rather than imported from a generated types file for the same
// reason status-badge.tsx does: no database.types.ts exists in this repo.
type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'void';

const LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  void: 'Void',
};

const CLASSES: Record<EstimateStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
  void: 'bg-zinc-200 text-zinc-700',
};

export function EstimateStatusBadge({ status }: { status: string }) {
  const known = status as EstimateStatus;
  const label = LABELS[known] ?? status;
  const classes = CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
