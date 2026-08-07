'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { parseCurrencyToCents } from '@/lib/money/cents';

export interface NewApplicationState {
  error?: string;
}

export async function createApplicationAction(
  _prevState: NewApplicationState,
  formData: FormData
): Promise<NewApplicationState> {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const permitTypeId = String(formData.get('permitTypeId') ?? '').trim();
  const contractorId = String(formData.get('contractorId') ?? '').trim();
  const projectTitle = String(formData.get('projectTitle') ?? '').trim();
  const projectAddress = String(formData.get('projectAddress') ?? '').trim();
  const estimatedValueRaw = String(formData.get('estimatedJobValue') ?? '').trim();

  if (!permitTypeId) {
    return { error: 'Select a jurisdiction and permit type.' };
  }
  if (!contractorId) {
    return { error: 'Select a contractor.' };
  }
  if (!projectTitle) {
    return { error: 'Project title is required.' };
  }
  if (!projectAddress) {
    return { error: 'Project address is required.' };
  }

  // estimated_job_value_cents is optional (nullable column) -- an empty
  // input means "not yet known," not zero. lib/money/cents.ts's
  // parseCurrencyToCents is float-free and returns null on anything
  // unparseable, so an unparseable string is rejected here rather than
  // silently coerced to 0 (same rule the money module documents for
  // itself).
  let estimatedJobValueCents: string | null = null;
  if (estimatedValueRaw) {
    const cents = parseCurrencyToCents(estimatedValueRaw);
    if (cents === null) {
      return { error: 'Estimated job value is not a valid dollar amount (e.g. 12500.00).' };
    }
    if (cents < 0n) {
      return { error: 'Estimated job value cannot be negative.' };
    }
    estimatedJobValueCents = cents.toString();
  }

  // Re-derive both foreign keys from the DB rather than trusting the
  // client-submitted option values, same discipline as generate-pdf.ts
  // re-checking coverage_level instead of trusting the triggering event:
  // a contractor_id must actually belong to this org (the <select> was
  // only ever populated from the org's own contractors, but a raw POST to
  // this action isn't bound by what the form rendered), and the
  // permit_type_id must actually exist.
  const { data: contractor } = await supabase
    .from('contractors')
    .select('id')
    .eq('id', contractorId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!contractor) {
    return { error: 'Selected contractor was not found in your organization.' };
  }

  const { data: permitType } = await supabase.from('permit_types').select('id').eq('id', permitTypeId).maybeSingle();
  if (!permitType) {
    return { error: 'Selected permit type was not found.' };
  }

  const { data: application, error: insertError } = await supabase
    .from('permit_applications')
    .insert({
      org_id: orgId,
      contractor_id: contractorId,
      permit_type_id: permitTypeId,
      project_title: projectTitle,
      project_address: projectAddress,
      estimated_job_value_cents: estimatedJobValueCents,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertError || !application) {
    return { error: insertError?.message ?? 'Failed to create application.' };
  }

  redirect(`/applications/${application.id}`);
}
