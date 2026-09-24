'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';
import { computePermitExpiryReminderSendAfter } from '@/lib/reminders/permit-expiry-schedule';

export interface PermitExpiryState {
  error?: string;
  success?: boolean;
}

// Deadline/expiry alerts, slice 2 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up). Single-table update, RLS-gated by permit_applications_update
// (is_org_member(org_id)) -- same explicit .eq('org_id', orgId)-alongside-
// .eq('id', ...) convention as app/(app)/clients/[id]/actions.ts's own
// updateClientAction() and the same rationale (its header comment).
export async function updatePermitExpiryAction(
  _prevState: PermitExpiryState,
  formData: FormData
): Promise<PermitExpiryState> {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const applicationId = String(formData.get('applicationId') ?? '');
  const permitExpiresOnRaw = String(formData.get('permitExpiresOn') ?? '').trim();

  if (!applicationId) {
    return { error: 'Missing application id.' };
  }

  const { error: updateError } = await supabase
    .from('permit_applications')
    .update({ permit_expires_on: permitExpiresOnRaw || null })
    .eq('id', applicationId)
    .eq('org_id', orgId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Best-effort reminder (re)scheduling -- same "a failed notification must
  // never break the primary business transaction it is describing"
  // philosophy as createContractorAction's own reminder-scheduling call
  // (app/(app)/contractors/new/actions.ts) and lib/audit/log.ts's
  // writeAuditLog(): the date itself is already saved above regardless of
  // whether anything below succeeds.
  //
  // Any still-pending 'permit_expiring' reminder for this application is
  // canceled first -- an org member canceling their own pending job is the
  // one RLS-legal update reminder_jobs_cancel allows (20260806000057) --
  // so editing the date (or clearing it) never leaves a stale reminder
  // scheduled off an expiry date that no longer applies. A fresh one is
  // inserted only when a date was actually provided.
  const { data: pendingReminders, error: pendingError } = await supabase
    .from('reminder_jobs')
    .select('id')
    .eq('org_id', orgId)
    .eq('target_kind', 'permit')
    .eq('target_id', applicationId)
    .eq('status', 'pending');

  if (pendingError) {
    console.error(
      `Failed to load pending permit_expiring reminder_jobs for application ${applicationId}: ${pendingError.message}`
    );
  } else if (pendingReminders && pendingReminders.length > 0) {
    const { error: cancelError } = await supabase
      .from('reminder_jobs')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancel_reason: 'Permit expiry date changed.',
      })
      .in(
        'id',
        pendingReminders.map((row) => row.id)
      );
    if (cancelError) {
      console.error(
        `Failed to cancel stale permit_expiring reminder_jobs for application ${applicationId}: ${cancelError.message}`
      );
    }
  }

  if (permitExpiresOnRaw) {
    const { error: reminderError } = await supabase.from('reminder_jobs').insert({
      org_id: orgId,
      kind: 'permit_expiring',
      target_kind: 'permit',
      target_id: applicationId,
      send_after: computePermitExpiryReminderSendAfter(permitExpiresOnRaw),
    });
    if (reminderError) {
      console.error(`Failed to schedule a permit-expiry reminder for application ${applicationId}: ${reminderError.message}`);
    }
  }

  // Server Component detail page reads this same row server-side -- same
  // reasoning as updateClientAction()'s own revalidatePath() call.
  revalidatePath(`/applications/${applicationId}`);

  return { success: true };
}
