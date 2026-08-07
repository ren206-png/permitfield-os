'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface OnboardingState {
  error?: string;
}

// Creates the org via the RPC that atomically inserts organizations + the
// caller's own org_members('owner') row -- organizations has no direct
// INSERT policy for `authenticated` (see migration 20260806000002), so this
// RPC is the *only* sanctioned way to create one; there is deliberately no
// fallback path here that inserts into `organizations` directly. Then
// creates a first contractor row so the org can immediately start an
// application (permit_applications.contractor_id is not-null, restrict-on-
// delete -- an application always needs a real contractor to file as).
export async function createOrganizationAction(
  _prevState: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const orgName = String(formData.get('orgName') ?? '').trim();
  const companyName = String(formData.get('companyName') ?? '').trim();
  const licenseNumber = String(formData.get('licenseNumber') ?? '').trim();
  const provinceCode = String(formData.get('provinceCode') ?? '')
    .trim()
    .toUpperCase();

  if (!orgName) {
    return { error: 'Organization name is required.' };
  }
  if (!companyName) {
    return { error: 'Company / contractor name is required.' };
  }
  if (provinceCode && provinceCode.length !== 2) {
    return { error: 'Province code must be 2 letters (e.g. ON, AB).' };
  }

  const { data: orgId, error: rpcError } = await supabase.rpc('create_organization_with_owner', {
    org_name: orgName,
  });
  if (rpcError || !orgId) {
    return { error: rpcError?.message ?? 'Failed to create organization.' };
  }

  const { error: contractorError } = await supabase.from('contractors').insert({
    org_id: orgId,
    company_name: companyName,
    primary_license_number: licenseNumber || null,
    license_province_code: provinceCode || null,
  });
  if (contractorError) {
    // The org itself was created successfully (visible via requireOrgContext
    // from this point on) -- only the first-contractor convenience insert
    // failed. Don't strand the user on a form that re-attempts org creation
    // (the RPC isn't idempotent by name and would create a second org);
    // send them to the applications list, which will itself prompt for a
    // contractor before allowing a new application (see applications/new).
    redirect('/applications');
  }

  redirect('/applications');
}
