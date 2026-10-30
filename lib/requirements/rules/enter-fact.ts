import type { SupabaseClient } from '@supabase/supabase-js';
import { isFactKey, parseFactValue } from './fact-keys';

// A project fact typed in by staff: the copilot's fact form (6.4) and the
// application page's requirements check both record answers through here.
// The person entering it confirms it, so it is written as 'confirmed'. If
// the key already has a confirmed value, the new row supersedes it (a
// correction) and the old one stays in the append-only ledger.
//
// `supabase` must be the caller's own session client: project_facts RLS
// decides whether this user may write facts for this org and project, and
// `scope` must come from a row that session could read -- never from a form.

export interface FactScope {
  orgId: string;
  projectId: string;
  userId: string;
}

export type EnterFactResult = { ok: true } | { ok: false; error: string };

export async function recordEnteredFact(
  supabase: SupabaseClient,
  scope: FactScope,
  key: string,
  rawValue: string
): Promise<EnterFactResult> {
  if (!isFactKey(key)) return { ok: false, error: 'Choose a fact.' };
  const parsed = parseFactValue(key, rawValue);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { data: current } = await supabase
    .from('project_facts')
    .select('id, state, supersedes_fact_id, created_at')
    .eq('org_id', scope.orgId)
    .eq('project_id', scope.projectId)
    .eq('fact_key', key)
    .eq('state', 'confirmed')
    .order('created_at', { ascending: false });
  const supersededIds = new Set((current ?? []).map((r) => r.supersedes_fact_id).filter(Boolean));
  const latest = (current ?? []).find((r) => !supersededIds.has(r.id)) ?? null;

  const now = new Date().toISOString();
  const { error } = await supabase.from('project_facts').insert({
    org_id: scope.orgId,
    project_id: scope.projectId,
    fact_key: key,
    value: parsed.value,
    unit: parsed.unit,
    provenance: 'user_entered',
    state: 'confirmed',
    reviewed_by: scope.userId,
    reviewed_at: now,
    supersedes_fact_id: latest?.id ?? null,
    created_by: scope.userId,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'Someone changed this fact at the same time. Refresh and try again.' : 'Could not save the fact.',
    };
  }
  return { ok: true };
}
