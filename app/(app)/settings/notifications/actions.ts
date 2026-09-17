'use server';

import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isNotificationsEnabled } from '@/lib/flags';

// Gate 5, sub-phase 5.3 hardening (per-user opt-out). Re-runs
// isNotificationsEnabled() and requireOrgContext() itself rather than
// trusting the calling page already checked -- same "a Server Action is a
// public, directly-invokable endpoint on its own" discipline
// app/admin/client-portal/actions.ts's header comment documents.
//
// No owner-only check (unlike billing's checkoutAction/portalAction) --
// this table is scoped to (org_id, user_id) and RLS's own
// notification_preferences_update policy (user_id = auth.uid()) already
// means a submission can only ever affect the calling user's own row, so
// there is no separate "who is allowed to change WHOSE preference"
// decision left for this action to enforce beyond what upsert's own target
// key already guarantees.

export interface NotificationPreferencesActionState {
  error?: string;
}

export async function toggleEmailNotificationsAction(
  _prevState: NotificationPreferencesActionState,
  formData: FormData
): Promise<NotificationPreferencesActionState> {
  if (!isNotificationsEnabled()) {
    return { error: 'Notifications are not enabled.' };
  }

  const { userId, orgId } = await requireOrgContext();

  // The button always submits the value it wants to move TO, not a
  // toggle-in-place flag -- same "client sends the intended next state,
  // not an ambiguous 'flip it' instruction" shape as every other
  // hidden-field-driven form in this codebase (see CheckoutButton's own
  // `tier` hidden field).
  const nextEnabled = String(formData.get('nextEnabled') ?? '') === 'true';

  const supabase = await createClient();
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      org_id: orgId,
      user_id: userId,
      email_enabled: nextEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,user_id' }
  );
  if (error) {
    return { error: `Failed to save your notification preference: ${error.message}` };
  }

  revalidatePath('/settings/notifications');

  return {};
}
