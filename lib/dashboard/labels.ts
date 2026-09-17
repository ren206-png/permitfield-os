// Dashboard UI (Gate 1.7 follow-up). supabase/migrations/
// 20260806000028_dashboard_queries.sql shipped five SQL functions with "zero
// UI, Route Handler, or Server Component call site" by explicit design
// (that migration's own header comment) -- this module, plus
// app/(app)/dashboard/page.tsx, is the "future dashboard route" it left as
// an intended-but-unbuilt contract.
//
// Every enum this dashboard renders gets its own literal union + exhaustive
// label map here, same discipline components/status-badge.tsx already
// established for application_status: a Record<Enum, string> forces this
// file to fail `tsc` the moment a migration adds a new enum value this
// dashboard doesn't yet know how to label, rather than silently rendering
// the raw DB string forever.

// project_status (20260806000019_lifecycle_intake_properties_clients_taxonomies.sql).
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'archived';

export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = ['draft', 'active', 'on_hold', 'completed', 'archived'];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

// permit_status_enum (20260806000022_permit_status_machine.sql), 16 values,
// kept in that migration's own declared order (its own comment already
// documents this as "the exact order it can progress").
export type PermitStatus =
  | 'intake'
  | 'requirements_review'
  | 'collecting_documents'
  | 'internal_review'
  | 'ready_to_submit'
  | 'withdrawn'
  | 'submitted'
  | 'under_municipal_review'
  | 'revision_requested'
  | 'resubmitted'
  | 'appeal_filed'
  | 'approved'
  | 'rejected'
  | 'issued'
  | 'expired'
  | 'closed';

export const PERMIT_STATUS_ORDER: readonly PermitStatus[] = [
  'intake',
  'requirements_review',
  'collecting_documents',
  'internal_review',
  'ready_to_submit',
  'withdrawn',
  'submitted',
  'under_municipal_review',
  'revision_requested',
  'resubmitted',
  'appeal_filed',
  'approved',
  'rejected',
  'issued',
  'expired',
  'closed',
];

export const PERMIT_STATUS_LABELS: Record<PermitStatus, string> = {
  intake: 'Intake',
  requirements_review: 'Requirements review',
  collecting_documents: 'Collecting documents',
  internal_review: 'Internal review',
  ready_to_submit: 'Ready to submit',
  withdrawn: 'Withdrawn',
  submitted: 'Submitted',
  under_municipal_review: 'Under municipal review',
  revision_requested: 'Revision requested',
  resubmitted: 'Resubmitted',
  appeal_filed: 'Appeal filed',
  approved: 'Approved',
  rejected: 'Rejected',
  issued: 'Issued',
  expired: 'Expired',
  closed: 'Closed',
};

// document_review_status (20260806000024_lifecycle_documents_revisions.sql).
export type DocumentReviewStatus = 'pending' | 'approved' | 'rejected';

export const DOCUMENT_REVIEW_STATUS_ORDER: readonly DocumentReviewStatus[] = ['pending', 'approved', 'rejected'];

export const DOCUMENT_REVIEW_STATUS_LABELS: Record<DocumentReviewStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
};

// Readiness score buckets -- not a DB enum, a literal text value
// dashboard_readiness_score_buckets() computes itself (that migration's own
// comment: "Bucket boundaries ... not spec-mandated -- a judgment call").
// Duplicated here as its own union rather than widened to `string` for the
// same exhaustiveness reason as the DB enums above.
export type ReadinessBucket = 'ready' | 'in_progress' | 'at_risk';

export const READINESS_BUCKET_ORDER: readonly ReadinessBucket[] = ['ready', 'in_progress', 'at_risk'];

export const READINESS_BUCKET_LABELS: Record<ReadinessBucket, string> = {
  ready: 'Ready (100%)',
  in_progress: 'In progress (50-99%)',
  at_risk: 'At risk (<50%)',
};

export interface PanelRow {
  label: string;
  count: number;
}

/**
 * Shared shaping step for every count-by-status panel: takes whatever rows
 * the RPC actually returned (a real 0-row result is this migration's own
 * documented "empty state", not an error -- see that file's header comment)
 * and produces one row per value in `order`, defaulting missing values to
 * 0 rather than omitting them, so a panel's own zero-count statuses are
 * still visible (e.g. "Rejected: 0") instead of silently disappearing.
 */
export function buildPanelRows<T extends string>(
  order: readonly T[],
  labels: Record<T, string>,
  counts: ReadonlyMap<T, number>
): PanelRow[] {
  return order.map((value) => ({ label: labels[value], count: counts.get(value) ?? 0 }));
}
