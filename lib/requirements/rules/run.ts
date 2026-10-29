import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isCopilotRulesEnabled } from '@/lib/flags';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';
import { resolveFacts, type ProjectFactRow } from './facts';
import { ENGINE_VERSION, evaluateRuleSet, summarizeEvaluation, type ApplicabilitySummary, type RuleSetEvaluation } from './rule-set';

// Gate 6.2: evaluates one permit application's requirements against the
// latest published rule set for its jurisdiction + permit type and the
// project's confirmed facts, and records one project_requirement_snapshots
// row per requirement (20260806000092).
//
// Authorization comes from the database: the application, facts and rule set
// are all read with the caller's own session, so RLS decides what exists for
// this user. The snapshot insert then uses the service client (snapshots are
// not user-writable; see service-client.ts Exception 8) with org_id and
// project_id taken from that RLS-visible application row -- never from an
// argument. Behind PERMITFIELD_FF_COPILOT_RULES.

export type EvaluateApplicationResult =
  | { ok: true; evaluation: RuleSetEvaluation; summary: ApplicabilitySummary; pendingProposals: string[]; snapshotCount: number }
  | { ok: false; error: 'disabled' | 'not_signed_in' | 'not_found' | 'no_project' | 'no_jurisdiction' | 'read_failed' | 'write_failed'; detail?: string };

export async function evaluateApplicationRequirements(applicationId: string): Promise<EvaluateApplicationResult> {
  if (!isCopilotRulesEnabled()) return { ok: false, error: 'disabled' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_signed_in' };
  return evaluateApplicationRequirementsWith(supabase, user.id, applicationId);
}

// Same evaluation with the caller's own session client passed in (the 6.4
// copilot tool). `supabase` must be a user-session client: every read below
// relies on its RLS, and `userId` must be that session's user.
export async function evaluateApplicationRequirementsWith(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string
): Promise<EvaluateApplicationResult> {
  if (!isCopilotRulesEnabled()) return { ok: false, error: 'disabled' };
  if (!z.guid().safeParse(applicationId).success) return { ok: false, error: 'not_found' };

  const { data: application, error: applicationError } = await supabase
    .from('permit_applications')
    .select('id, org_id, project_id, permit_type_id, permit_types ( jurisdiction_id )')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) return { ok: false, error: 'read_failed', detail: applicationError.message };
  if (!application) return { ok: false, error: 'not_found' };
  if (!application.project_id) return { ok: false, error: 'no_project' };
  const permitType = Array.isArray(application.permit_types) ? application.permit_types[0] : application.permit_types;
  const jurisdictionId = (permitType as { jurisdiction_id?: string } | null)?.jurisdiction_id;
  if (!jurisdictionId) return { ok: false, error: 'no_jurisdiction' };

  const [factsResult, ruleSetResult, catalogResult] = await Promise.all([
    supabase
      .from('project_facts')
      .select('id, fact_key, value, unit, state, supersedes_fact_id, created_at')
      .eq('org_id', application.org_id)
      .eq('project_id', application.project_id),
    supabase
      .from('rule_set_versions')
      .select('id, version')
      .eq('jurisdiction_id', jurisdictionId)
      .eq('permit_type_id', application.permit_type_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('permit_requirements')
      .select('id')
      .eq('permit_type_id', application.permit_type_id)
      .is('archived_at', null),
  ]);
  const readError = factsResult.error ?? ruleSetResult.error ?? catalogResult.error;
  if (readError) return { ok: false, error: 'read_failed', detail: readError.message };

  let ruleSet: { id: string; items: { permitRequirementId: string; snapshot: unknown }[] } | null = null;
  if (ruleSetResult.data) {
    const { data: items, error: itemsError } = await supabase
      .from('rule_set_version_items')
      .select('permit_requirement_id, requirement_snapshot')
      .eq('rule_set_version_id', ruleSetResult.data.id);
    if (itemsError) return { ok: false, error: 'read_failed', detail: itemsError.message };
    ruleSet = {
      id: ruleSetResult.data.id,
      items: (items ?? []).map((i) => ({ permitRequirementId: i.permit_requirement_id, snapshot: i.requirement_snapshot })),
    };
  }

  const { facts, pendingProposals } = resolveFacts((factsResult.data ?? []) as ProjectFactRow[]);
  const evaluation = evaluateRuleSet({
    ruleSet,
    catalogRequirementIds: (catalogResult.data ?? []).map((r) => r.id),
    facts,
  });

  const evaluatedAt = new Date().toISOString();
  const rows = evaluation.outcomes.map((o) => ({
    org_id: application.org_id,
    project_id: application.project_id,
    rule_set_version_id: evaluation.coverage === 'published_rule_set' ? evaluation.ruleSetVersionId : null,
    permit_requirement_id: o.permitRequirementId,
    outcome: o.outcome,
    fact_ids: o.factIds,
    explanation: {
      engine_version: ENGINE_VERSION,
      coverage: evaluation.coverage,
      reason: o.reason,
      trace: o.trace,
      prerequisites: o.prerequisites,
      warnings: o.warnings,
      ...(evaluation.coverage === 'rule_set_invalid' ? { evaluated_rule_set_version_id: evaluation.ruleSetVersionId } : {}),
    },
    evaluated_by: userId,
    evaluated_at: evaluatedAt,
  }));

  if (rows.length > 0) {
    const { error: insertError } = await createServiceClient().from('project_requirement_snapshots').insert(rows);
    if (insertError) return { ok: false, error: 'write_failed', detail: insertError.message };
  }

  return { ok: true, evaluation, summary: summarizeEvaluation(evaluation), pendingProposals, snapshotCount: rows.length };
}
