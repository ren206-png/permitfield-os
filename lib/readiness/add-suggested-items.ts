import type { SupabaseClient } from '@supabase/supabase-js';
import { suggestedChecklistItems } from './readiness';

// Adds the suggested starter checklist (lib/readiness/readiness.ts) to an
// application, skipping titles already on it. Used by the "Add suggested
// items" button (as the member) and by form generation (as the service role,
// only when the checklist is still empty -- an empty checklist would
// otherwise count as complete and let Ready to submit through unchecked).
export async function addSuggestedChecklistItems(
  supabase: SupabaseClient,
  input: { orgId: string; applicationId: string; permitTypeId: string }
): Promise<{ added: number } | { error: string }> {
  const [{ data: filings }, { data: generated }, { data: existing, error: existingError }] = await Promise.all([
    supabase
      .from('permit_type_filings')
      .select('id, authorities ( name, esignature_accepted ), permit_form_signature_slots ( signer_role )')
      .eq('permit_type_id', input.permitTypeId)
      .order('sequence', { ascending: true }),
    supabase.from('generated_documents').select('permit_type_filing_id').eq('application_id', input.applicationId),
    supabase.from('readiness_checklist_items').select('title').eq('application_id', input.applicationId).eq('org_id', input.orgId),
  ]);
  if (existingError) return { error: existingError.message };

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
    existingTitles: (existing ?? []).map((row) => row.title),
  });
  if (items.length === 0) return { added: 0 };

  const { error } = await supabase
    .from('readiness_checklist_items')
    .insert(items.map((item) => ({ org_id: input.orgId, application_id: input.applicationId, title: item.title, description: item.description })));
  return error ? { error: error.message } : { added: items.length };
}
