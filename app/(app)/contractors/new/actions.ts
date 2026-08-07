'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';

export interface NewContractorState {
  error?: string;
}

export async function createContractorAction(
  _prevState: NewContractorState,
  formData: FormData
): Promise<NewContractorState> {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const companyName = String(formData.get('companyName') ?? '').trim();
  const licenseNumber = String(formData.get('licenseNumber') ?? '').trim();
  const provinceCode = String(formData.get('provinceCode') ?? '').trim().toUpperCase();
  const expiresOnRaw = String(formData.get('licenseExpiresOn') ?? '').trim();

  if (!companyName) {
    return { error: 'Company name is required.' };
  }
  if (provinceCode && provinceCode.length !== 2) {
    return { error: 'Province code must be 2 letters (e.g. ON, AB).' };
  }

  // Redirect target: the wizard sends contractors here when an org has zero
  // contractors, then expects to return to /applications/new once one exists.
  const returnTo = String(formData.get('returnTo') ?? '/applications/new').trim();
  const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/applications/new';

  const { error: insertError } = await supabase.from('contractors').insert({
    org_id: orgId,
    company_name: companyName,
    primary_license_number: licenseNumber || null,
    license_province_code: provinceCode || null,
    license_expires_on: expiresOnRaw || null,
  });

  if (insertError) {
    return { error: insertError.message };
  }

  redirect(safeReturnTo);
}
