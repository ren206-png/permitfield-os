import type { SupabaseClient } from '@supabase/supabase-js';
import { suggestedChecklistItems } from './readiness';

// Adds the suggested starter checklist (lib/readiness/readiness.ts) to an
// application, skipping titles already on it. Used by the "Add suggested
// items" button (as the member) and by form generation (as the service role,
// only when the checklist is still empty -- an empty checklist would
// otherwise count as complete and let Ready to submit through unchecked).
// The city's own submission checklist comes from permit_requirements
// (20260806000080), each item carrying its source page as source_requirement,
// and the latest requirements check (project_requirement_snapshots) decides
// which of them are left off or required.
export async function addSuggestedChecklistItems(
  supabase: SupabaseClient,
  input: { orgId: string; applicationId: string; permitTypeId: string }
): Promise<{ added: number; updated: number } | { error: string }> {
  const [
    { data: filings },
    { data: generated },
    { data: requirements, error: requirementsError },
    { data: existing, error: existingError },
    outcomes,
  ] = await Promise.all([
      supabase
        .from('permit_type_filings')
        .select('id, authorities ( name, esignature_accepted ), permit_form_signature_slots ( signer_role )')
        .eq('permit_type_id', input.permitTypeId)
        .order('sequence', { ascending: true }),
      supabase.from('generated_documents').select('permit_type_filing_id').eq('application_id', input.applicationId),
      supabase
        .from('permit_requirements')
        .select('id, title, description, applies_when, jurisdiction_sources ( url )')
        .eq('permit_type_id', input.permitTypeId)
        .is('archived_at', null)
        .order('display_order', { ascending: true, nullsFirst: false }),
      supabase
        .from('readiness_checklist_items')
        .select('id, title, status, is_required, catalog_requirement_id')
        .eq('application_id', input.applicationId)
        .eq('org_id', input.orgId),
      latestCheckOutcomes(supabase, input),
    ]);
  if (existingError) return { error: existingError.message };
  if (requirementsError) return { error: requirementsError.message };

  const generatedFilings = new Set((generated ?? []).map((g) => g.permit_type_filing_id));
  const items = suggestedChecklistItems({
    filings: (filings ?? []).map((f) => {
      const authority = Array.isArray(f.authorities) ? f.authorities[0] : f.authorities;
      return {
        authorityName: authority?.name ?? 'authority',
        hasFilledForm: generatedFilings.has(f.id),
        esignatureAccepted: Boolean(authority?.esignature_accepted),
        hasSignatureSlot: (f.permit_form_signature_slots ?? []).length > 0,
      };
    }),
    cityRequirements: (requirements ?? []).map((r) => {
      const source = Array.isArray(r.jurisdiction_sources) ? r.jurisdiction_sources[0] : r.jurisdiction_sources;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        appliesWhen: r.applies_when,
        sourceUrl: source?.url ?? null,
        outcome: outcomes.get(r.id) ?? null,
      };
    }),
    existingTitles: (existing ?? []).map((row) => row.title),
  });

  // City items already on the checklist follow a newer check too: a later
  // answer can rule one out (not_applicable makes it optional) or bring it
  // back (applicable/unknown makes it required). Completed items are left
  // alone, and nothing is deleted -- an item that no longer applies stays
  // visible as optional.
  const resync = (existing ?? []).filter((row) => {
    const outcome = row.catalog_requirement_id ? outcomes.get(row.catalog_requirement_id as string) : undefined;
    if (!outcome || row.status === 'complete') return false;
    return row.is_required !== (outcome !== 'not_applicable');
  });
  for (const row of resync) {
    const { error } = await supabase
      .from('readiness_checklist_items')
      .update({ is_required: !row.is_required })
      .eq('id', row.id)
      .eq('org_id', input.orgId);
    if (error) return { error: error.message };
  }
  const updated = resync.length;

  if (items.length === 0) return { added: 0, updated };

  // One insert gives every row the same now(); the panel lists by created_at,
  // so step it by a millisecond per item to keep the city checklist's order.
  const base = Date.now();
  const { error } = await supabase.from('readiness_checklist_items').insert(
    items.map((item, index) => ({
      created_at: new Date(base + index).toISOString(),
      org_id: input.orgId,
      application_id: input.applicationId,
      title: item.title,
      description: item.description,
      is_required: item.isRequired,
      source_requirement: item.sourceRequirement,
      catalog_requirement_id: item.catalogRequirementId ?? null,
    }))
  );
  return error ? { error: error.message } : { added: items.length, updated };
}

type Outcome = 'applicable' | 'not_applicable' | 'unknown';

// The latest requirements check for the application's project, by
// requirement: the most recent evaluated_at batch, the same reading as the
// Requirements check panel (app/(app)/applications/[id]/rule-check-section.tsx).
// Empty when the check has never run, which leaves the checklist's own
// required/optional split in place.
async function latestCheckOutcomes(
  supabase: SupabaseClient,
  input: { orgId: string; applicationId: string }
): Promise<Map<string, Outcome>> {
  const outcomes = new Map<string, Outcome>();
  const { data: application } = await supabase
    .from('permit_applications')
    .select('project_id')
    .eq('id', input.applicationId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  const projectId = (application?.project_id as string | null | undefined) ?? null;
  if (!projectId) return outcomes;
  const { data: snapshots } = await supabase
    .from('project_requirement_snapshots')
    .select('permit_requirement_id, outcome, evaluated_at')
    .eq('org_id', input.orgId)
    .eq('project_id', projectId)
    .order('evaluated_at', { ascending: false })
    .limit(500);
  const latestAt = snapshots?.[0]?.evaluated_at ?? null;
  for (const row of snapshots ?? []) {
    if (row.evaluated_at !== latestAt || !row.permit_requirement_id) continue;
    outcomes.set(row.permit_requirement_id as string, row.outcome as Outcome);
  }
  return outcomes;
}
