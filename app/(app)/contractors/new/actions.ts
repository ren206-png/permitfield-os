'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { computeContractorLicenseReminderSendAfter } from '@/lib/reminders/contractor-license-schedule';

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

  const { data: inserted, error: insertError } = await supabase
    .from('contractors')
    .insert({
      org_id: orgId,
      company_name: companyName,
      primary_license_number: licenseNumber || null,
      license_province_code: provinceCode || null,
      license_expires_on: expiresOnRaw || null,
    })
    .select('id')
    .single();

  if (insertError) {
    return { error: insertError.message };
  }

  // Deadline/expiry alerts, slice 1 (MARKETING_CAPABILITY_LEDGER.md §17
  // follow-up; 20260806000065_contractor_license_expiry_reminders.sql).
  // Best-effort, non-blocking, same "a failed notification must never
  // break the primary business transaction it is describing" philosophy
  // as lib/audit/log.ts's writeAuditLog() -- a contractor is fully created
  // above regardless of whether this scheduling insert succeeds. Only
  // fires when a license expiry date was actually provided; nothing here
  // checks isDeadlineRemindersEnabled() (see that flag's own header
  // comment in lib/flags.ts for why the send-side gate, not this
  // schedule-side one, is where it belongs).
  if (expiresOnRaw && inserted?.id) {
    const { error: reminderError } = await supabase.from('reminder_jobs').insert({
      org_id: orgId,
      kind: 'contractor_license_expiring',
      target_kind: 'contractor',
      target_id: inserted.id,
      send_after: computeContractorLicenseReminderSendAfter(expiresOnRaw),
    });
    if (reminderError) {
      console.error(`Failed to schedule a license-expiry reminder for contractor ${inserted.id}: ${reminderError.message}`);
    }
  }

  redirect(safeReturnTo);
}
