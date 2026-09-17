import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isDashboardEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { LockedFeature } from '@/components/locked-feature';
import { DashboardPanel, DashboardStatsPanel } from '@/components/dashboard-panel';
import {
  buildPanelRows,
  DOCUMENT_REVIEW_STATUS_LABELS,
  DOCUMENT_REVIEW_STATUS_ORDER,
  PERMIT_STATUS_LABELS,
  PERMIT_STATUS_ORDER,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  READINESS_BUCKET_LABELS,
  READINESS_BUCKET_ORDER,
  type DocumentReviewStatus,
  type PermitStatus,
  type ProjectStatus,
  type ReadinessBucket,
} from '@/lib/dashboard/labels';

// Dashboard UI. supabase/migrations/20260806000028_dashboard_queries.sql
// shipped five dashboard_*() SQL functions (flag PERMITFIELD_FF_DASHBOARD,
// entitlement 'analytics') with zero call site by explicit scope decision --
// "the user explicitly scoped this gate to 'the dashboard query layer' ...
// not the panels themselves" (that migration's own header comment). This
// page is that deferred call site, built per the contract that migration
// documented for it:
//   - check is_org_member (via requireOrgContext) + can(orgId, 'analytics')
//     BEFORE calling any dashboard_*() function -- permission-denied means
//     no query is ever issued, not a query that comes back empty.
//   - a real 0-row RPC result is the EMPTY state, not an error or a
//     permission failure -- see DashboardPanel's own header comment.
//   - "loading" state is this route's own loading.tsx (Next's Suspense-
//     backed streaming for an async Server Component), not built per-panel
//     here -- five single-table group-by queries are fast enough that a
//     whole-page skeleton is a reasonable simplification, flagged rather
//     than silently assumed.
//   - "error" state is app/(app)/error.tsx, the same layout-wide boundary
//     every other (app) route now falls back to -- this page doesn't
//     catch RPC errors itself, it lets them throw, matching every other
//     page in this codebase's own "if (error) throw" convention.
export default async function DashboardPage() {
  if (!isDashboardEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'analytics');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Dashboard unavailable"
        message="Your organization's plan does not include the analytics dashboard."
      />
    );
  }

  const supabase = await createClient();

  // Five independent single-table queries (per that migration's own "query
  // count per dashboard load: 5" invariant) -- Promise.all so they run
  // concurrently rather than five sequential round trips.
  const [projectStatusResult, permitStatusResult, readinessResult, requirementsResult, documentReviewResult] =
    await Promise.all([
      supabase.rpc('dashboard_project_status_counts', { p_org_id: orgId }),
      supabase.rpc('dashboard_permit_status_counts', { p_org_id: orgId }),
      supabase.rpc('dashboard_readiness_score_buckets', { p_org_id: orgId }),
      supabase.rpc('dashboard_requirements_summary', { p_org_id: orgId }),
      supabase.rpc('dashboard_document_review_counts', { p_org_id: orgId }),
    ]);

  for (const { error } of [projectStatusResult, permitStatusResult, readinessResult, requirementsResult, documentReviewResult]) {
    if (error) {
      throw new Error(`Failed to load dashboard data: ${error.message}`);
    }
  }

  const projectStatusCounts = new Map<ProjectStatus, number>(
    (projectStatusResult.data ?? []).map((row: { status: ProjectStatus; count: number }) => [row.status, row.count])
  );
  const permitStatusCounts = new Map<PermitStatus, number>(
    (permitStatusResult.data ?? []).map((row: { permit_status: PermitStatus; count: number }) => [
      row.permit_status,
      row.count,
    ])
  );
  const readinessCounts = new Map<ReadinessBucket, number>(
    (readinessResult.data ?? []).map((row: { bucket: ReadinessBucket; count: number }) => [row.bucket, row.count])
  );
  const documentReviewCounts = new Map<DocumentReviewStatus, number>(
    (documentReviewResult.data ?? []).map((row: { status: DocumentReviewStatus; count: number }) => [
      row.status,
      row.count,
    ])
  );
  // dashboard_requirements_summary() returns exactly one row (an aggregate
  // over the whole org, not a group-by) -- null only if the org has literally
  // zero project_permit_requirements rows, in which case every scalar is 0,
  // same "0 rows in -> 0 counts out" empty-state treatment as every other
  // panel here.
  const requirementsSummary = requirementsResult.data?.[0] ?? { matched: 0, unresolved: 0, with_warnings: 0 };

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Dashboard</h1>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DashboardPanel
          title="Projects by status"
          rows={buildPanelRows(PROJECT_STATUS_ORDER, PROJECT_STATUS_LABELS, projectStatusCounts)}
          emptyMessage="No projects yet."
        />
        <DashboardPanel
          title="Permit pipeline"
          rows={buildPanelRows(PERMIT_STATUS_ORDER, PERMIT_STATUS_LABELS, permitStatusCounts)}
          emptyMessage="No permit applications yet."
        />
        <DashboardPanel
          title="Readiness score"
          rows={buildPanelRows(READINESS_BUCKET_ORDER, READINESS_BUCKET_LABELS, readinessCounts)}
          emptyMessage="No permit applications to score yet."
        />
        <DashboardPanel
          title="Document review"
          rows={buildPanelRows(DOCUMENT_REVIEW_STATUS_ORDER, DOCUMENT_REVIEW_STATUS_LABELS, documentReviewCounts)}
          emptyMessage="No documents uploaded yet."
        />
        <DashboardStatsPanel
          title="Requirements engine"
          stats={[
            { label: 'Matched', count: requirementsSummary.matched },
            { label: 'Unresolved', count: requirementsSummary.unresolved },
            { label: 'With warnings', count: requirementsSummary.with_warnings },
          ]}
        />
      </div>
    </div>
  );
}
