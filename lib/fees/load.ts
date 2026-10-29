import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import { computeFreshness, type SourceType } from '@/lib/sources/freshness';
import { estimateFees, type FeeEstimate, type FeeScheduleRecord } from './estimate';
import type { RoundingRule } from './money';

// Gate 6.5: reads what a fee estimate needs with the caller's own session
// (RLS): the fee schedule version in force for the permit type (else the
// newest one, which the engine then reports as stale), its source's
// freshness, the project's confirmed facts and the application's job value.

interface ScheduleRow {
  id: string;
  version: number;
  currency: string;
  rounding_rule: RoundingRule;
  effective_from: string;
  effective_to: string | null;
  parameters: unknown;
  source_revisions: { source_id: string; jurisdiction_sources: { source_type: SourceType } | { source_type: SourceType }[] | null } | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadFeeSchedule(
  supabase: SupabaseClient,
  params: { jurisdictionId: string; permitTypeId: string; asOf: string; now?: Date }
): Promise<FeeScheduleRecord | null> {
  const { data, error } = await supabase
    .from('fee_schedule_versions')
    .select('id, version, currency, rounding_rule, effective_from, effective_to, parameters, source_revisions ( source_id, jurisdiction_sources ( source_type ) )')
    .eq('jurisdiction_id', params.jurisdictionId)
    .eq('permit_type_id', params.permitTypeId)
    .is('authority_id', null)
    .order('version', { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not read fee schedules: ${error.message}`);
  const rows = (data ?? []) as unknown as ScheduleRow[];
  const chosen = rows.find((r) => r.effective_from <= params.asOf) ?? rows[0];
  if (!chosen) return null;

  const revision = chosen.source_revisions;
  let sourceOverdue = true;
  if (revision) {
    const sourceType = one(revision.jurisdiction_sources)?.source_type ?? 'fee_schedule';
    const { data: lastOk } = await supabase
      .from('source_check_runs')
      .select('checked_at')
      .eq('source_id', revision.source_id)
      .in('outcome', ['changed', 'unchanged', 'not_modified'])
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    sourceOverdue = computeFreshness(sourceType, lastOk?.checked_at ?? null, params.now) !== 'fresh';
  }
  return {
    id: chosen.id,
    version: chosen.version,
    currency: chosen.currency,
    roundingRule: chosen.rounding_rule,
    effectiveFrom: chosen.effective_from,
    effectiveTo: chosen.effective_to,
    parameters: chosen.parameters,
    sourceOverdue,
  };
}

export async function estimateApplicationFees(
  supabase: SupabaseClient,
  scope: { orgId: string; projectId: string | null; applicationId: string; jurisdictionId: string; permitTypeId: string },
  now: Date = new Date()
): Promise<FeeEstimate> {
  const asOf = now.toISOString().slice(0, 10);
  const [schedule, { data: application }, { data: factRows }] = await Promise.all([
    loadFeeSchedule(supabase, { jurisdictionId: scope.jurisdictionId, permitTypeId: scope.permitTypeId, asOf, now }),
    supabase.from('permit_applications').select('estimated_job_value_cents').eq('id', scope.applicationId).maybeSingle(),
    scope.projectId
      ? supabase
          .from('project_facts')
          .select('id, fact_key, value, unit, state, supersedes_fact_id, created_at')
          .eq('org_id', scope.orgId)
          .eq('project_id', scope.projectId)
      : Promise.resolve({ data: [] as ProjectFactRow[] }),
  ]);
  const { facts } = resolveFacts((factRows ?? []) as ProjectFactRow[]);
  const jobValue = application?.estimated_job_value_cents;
  return estimateFees(schedule, { facts, jobValueMinor: typeof jobValue === 'number' ? jobValue : jobValue ? Number(jobValue) : null, asOf });
}
