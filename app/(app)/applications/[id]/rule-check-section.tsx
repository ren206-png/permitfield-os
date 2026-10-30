import { ConditionSchema, factKeysIn } from '@/lib/requirements/rules/condition';
import { describeFactValue, FACT_KEYS, isFactKey } from '@/lib/requirements/rules/fact-keys';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import { createClient } from '@/lib/supabase/server';
import { RuleCheckPanel, type RuleCheckView, type RuleQuestion } from './rule-check-panel';

// Gate 6.5: loads the latest requirements check for the application's
// project with the caller's own session (RLS) and renders RuleCheckPanel.
// The "latest" check is the newest batch of snapshots (one evaluated_at).
// Also lists the project questions the latest published rule set's
// conditions read, with the current confirmed answers, so staff can answer
// them here without the copilot. An application without a project still
// shows the panel; the first check or answer creates its project
// (rule-check-actions.ts).

export async function RuleCheckSection({ applicationId }: { applicationId: string }) {
  const supabase = await createClient();
  const { data: application } = await supabase
    .from('permit_applications')
    .select('org_id, project_id, permit_type_id, permit_types ( jurisdiction_id )')
    .eq('id', applicationId)
    .maybeSingle();
  if (!application) return null;
  const projectId = application.project_id as string | null;
  const permitType = Array.isArray(application.permit_types) ? application.permit_types[0] : application.permit_types;
  const jurisdictionId = (permitType as { jurisdiction_id?: string } | null)?.jurisdiction_id ?? null;

  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: snapshots }, { data: ruleSet }, { data: factRows }] = await Promise.all([
    projectId
      ? supabase
          .from('project_requirement_snapshots')
          .select('permit_requirement_id, outcome, explanation, evaluated_at')
          .eq('org_id', application.org_id)
          .eq('project_id', projectId)
          .order('evaluated_at', { ascending: false })
          .limit(500)
      : none,
    jurisdictionId
      ? supabase
          .from('rule_set_versions')
          .select('id')
          .eq('jurisdiction_id', jurisdictionId)
          .eq('permit_type_id', application.permit_type_id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    projectId
      ? supabase
          .from('project_facts')
          .select('id, fact_key, value, unit, state, supersedes_fact_id, created_at')
          .eq('org_id', application.org_id)
          .eq('project_id', projectId)
      : none,
  ]);
  const latestAt = snapshots?.[0]?.evaluated_at ?? null;
  const batch = (snapshots ?? []).filter((s) => s.evaluated_at === latestAt);
  const ids = batch.map((s) => s.permit_requirement_id).filter(Boolean) as string[];
  const [{ data: requirements }, { data: ruleItems }] = await Promise.all([
    ids.length ? supabase.from('permit_requirements').select('id, title').in('id', ids) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    ruleSet
      ? supabase.from('rule_set_version_items').select('requirement_snapshot').eq('rule_set_version_id', ruleSet.id)
      : Promise.resolve({ data: [] as { requirement_snapshot: unknown }[] }),
  ]);
  const titles = new Map((requirements ?? []).map((r) => [r.id, r.title]));
  const title = (id: string | null) => (id ? (titles.get(id) ?? 'A requirement') : 'A requirement');

  // Questions: the known fact keys the published conditions read.
  const questionKeys: string[] = [];
  for (const item of ruleItems ?? []) {
    const parsed = ConditionSchema.safeParse((item.requirement_snapshot as { condition?: unknown } | null)?.condition);
    if (!parsed.success) continue;
    for (const key of factKeysIn(parsed.data)) if (isFactKey(key) && !questionKeys.includes(key)) questionKeys.push(key);
  }
  const { facts } = resolveFacts((factRows ?? []) as ProjectFactRow[]);
  const questions: RuleQuestion[] = questionKeys.filter(isFactKey).map((key) => {
    const def = FACT_KEYS[key];
    const fact = facts.get(key);
    return {
      key,
      label: def.label,
      kind: def.kind,
      values: 'values' in def ? [...def.values] : [],
      hint: 'hint' in def ? def.hint : null,
      answer: fact?.status === 'confirmed' ? describeFactValue(key, fact.value, fact.unit) : null,
      awaitingReview: fact?.status === 'awaiting_confirmation',
    };
  });

  const view: RuleCheckView = {
    evaluatedAt: latestAt,
    coverage: (batch[0]?.explanation as { coverage?: string } | undefined)?.coverage ?? null,
    applicable: batch.filter((s) => s.outcome === 'applicable').map((s) => title(s.permit_requirement_id)),
    notApplicable: batch.filter((s) => s.outcome === 'not_applicable').map((s) => title(s.permit_requirement_id)),
    unknown: batch
      .filter((s) => s.outcome === 'unknown')
      .map((s) => ({ title: title(s.permit_requirement_id), reason: (s.explanation as { reason?: string }).reason ?? 'unknown' })),
    questions,
  };
  return <RuleCheckPanel applicationId={applicationId} view={view} />;
}
