import { createClient } from '@/lib/supabase/server';
import { LifecyclePanel, type LifecycleView } from './lifecycle-panel';

// Gate 6.6: loads the permit lifecycle records for one application with the
// caller's own session (RLS) and renders LifecyclePanel.

export async function LifecycleSection({ applicationId }: { applicationId: string }) {
  const supabase = await createClient();
  const [observations, conditions, inspections, packages] = await Promise.all([
    supabase
      .from('permit_status_observations')
      .select('id, source, external_status, observed_status, observed_at, outcome, external_reference, recorded_at')
      .eq('application_id', applicationId)
      .order('observed_at', { ascending: false })
      .limit(20),
    supabase.from('permit_conditions').select('id, condition_text, category, created_at').eq('application_id', applicationId).order('created_at'),
    supabase
      .from('inspection_records')
      .select('id, inspection_type, outcome, occurred_on, provenance, notes')
      .eq('application_id', applicationId)
      .order('occurred_on', { ascending: false })
      .limit(30),
    supabase
      .from('submission_packages')
      .select('id, version, manifest, manifest_sha256, created_at')
      .eq('application_id', applicationId)
      .order('version', { ascending: false })
      .limit(10),
  ]);
  // Scoped to this application's own conditions and packages.
  const conditionIdList = (conditions.data ?? []).map((c) => c.id);
  const packageIdList = (packages.data ?? []).map((p) => p.id);
  const [events, approvals] = await Promise.all([
    conditionIdList.length
      ? supabase.from('permit_condition_events').select('condition_id, status, note, recorded_at').in('condition_id', conditionIdList).order('recorded_at', { ascending: false })
      : Promise.resolve({ data: [] as { condition_id: string; status: string; note: string | null; recorded_at: string }[] }),
    packageIdList.length
      ? supabase.from('submission_package_approvals').select('package_id, approved_at, note').in('package_id', packageIdList)
      : Promise.resolve({ data: [] as { package_id: string; approved_at: string; note: string | null }[] }),
  ]);
  const conditionIds = new Set((conditions.data ?? []).map((c) => c.id));
  const latestEvent = new Map<string, { status: string; note: string | null }>();
  for (const e of events.data ?? []) {
    if (conditionIds.has(e.condition_id) && !latestEvent.has(e.condition_id)) latestEvent.set(e.condition_id, { status: e.status, note: e.note });
  }
  const approvalByPackage = new Map((approvals.data ?? []).map((a) => [a.package_id, a]));

  const view: LifecycleView = {
    observations: (observations.data ?? []).map((o) => ({
      id: o.id,
      source: o.source,
      externalStatus: o.external_status,
      observedStatus: o.observed_status,
      observedAt: o.observed_at,
      outcome: o.outcome,
      reference: o.external_reference,
    })),
    conditions: (conditions.data ?? []).map((c) => ({
      id: c.id,
      text: c.condition_text,
      category: c.category,
      status: latestEvent.get(c.id)?.status ?? 'open',
      note: latestEvent.get(c.id)?.note ?? null,
    })),
    inspections: (inspections.data ?? []).map((i) => ({ id: i.id, type: i.inspection_type, outcome: i.outcome, occurredOn: i.occurred_on, provenance: i.provenance, notes: i.notes })),
    packages: (packages.data ?? []).map((p) => {
      const approval = approvalByPackage.get(p.id);
      return {
        id: p.id,
        version: p.version,
        sha256: p.manifest_sha256,
        createdAt: p.created_at,
        manifest: p.manifest,
        unresolved: ((p.manifest as { unresolved?: string[] }).unresolved ?? []).length,
        approvedAt: approval?.approved_at ?? null,
      };
    }),
  };
  return <LifecyclePanel applicationId={applicationId} view={view} />;
}
