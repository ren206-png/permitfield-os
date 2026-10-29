import { createClient } from '@/lib/supabase/server';
import { RuleCheckPanel, type RuleCheckView } from './rule-check-panel';

// Gate 6.5: loads the latest requirements check for the application's
// project with the caller's own session (RLS) and renders RuleCheckPanel.
// The "latest" check is the newest batch of snapshots (one evaluated_at).

export async function RuleCheckSection({ applicationId }: { applicationId: string }) {
  const supabase = await createClient();
  const { data: application } = await supabase
    .from('permit_applications')
    .select('org_id, project_id, permit_type_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (!application?.project_id) return null;

  const { data: snapshots } = await supabase
    .from('project_requirement_snapshots')
    .select('permit_requirement_id, outcome, explanation, evaluated_at')
    .eq('org_id', application.org_id)
    .eq('project_id', application.project_id)
    .order('evaluated_at', { ascending: false })
    .limit(500);
  const latestAt = snapshots?.[0]?.evaluated_at ?? null;
  const batch = (snapshots ?? []).filter((s) => s.evaluated_at === latestAt);
  const ids = batch.map((s) => s.permit_requirement_id).filter(Boolean) as string[];
  const { data: requirements } = ids.length
    ? await supabase.from('permit_requirements').select('id, title').in('id', ids)
    : { data: [] as { id: string; title: string }[] };
  const titles = new Map((requirements ?? []).map((r) => [r.id, r.title]));
  const title = (id: string | null) => (id ? (titles.get(id) ?? 'A requirement') : 'A requirement');

  const view: RuleCheckView = {
    evaluatedAt: latestAt,
    coverage: (batch[0]?.explanation as { coverage?: string } | undefined)?.coverage ?? null,
    applicable: batch.filter((s) => s.outcome === 'applicable').map((s) => title(s.permit_requirement_id)),
    notApplicable: batch.filter((s) => s.outcome === 'not_applicable').map((s) => title(s.permit_requirement_id)),
    unknown: batch
      .filter((s) => s.outcome === 'unknown')
      .map((s) => ({ title: title(s.permit_requirement_id), reason: (s.explanation as { reason?: string }).reason ?? 'unknown' })),
  };
  return <RuleCheckPanel applicationId={applicationId} view={view} />;
}
