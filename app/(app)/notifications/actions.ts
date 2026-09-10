'use server';

import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isFailureNotificationsEnabled } from '@/lib/flags';

// Failure-notification system (PERMITFIELD_FF_FAILURE_NOTIFICATIONS). Same
// "re-check the flag inside the Server Action itself" discipline as
// app/(app)/settings/billing/actions.ts's own header comment: a Server
// Action is directly invokable independent of the page that renders it, so
// the page's own notFound() gate isn't enough on its own.
//
// Uses the session-scoped client (lib/supabase/server.ts), not
// lib/supabase/service-client.ts -- marking a notification read is an
// end-user action, and notifications_update's RLS policy
// (20260806000044_notifications.sql, is_org_member(org_id)) is the actual
// enforcement surface here: the .eq('org_id', orgId) below is redundant
// with RLS but kept anyway for the same "reads correctly on its own"
// reason app/(app)/applications/page.tsx's header comment gives, and the
// .eq('id', notificationId) is what actually narrows the update to one row.
export async function markNotificationReadAction(formData: FormData): Promise<void> {
  if (!isFailureNotificationsEnabled()) {
    notFound();
  }

  const notificationId = formData.get('notificationId');
  if (typeof notificationId !== 'string' || notificationId.length === 0) {
    throw new Error('markNotificationReadAction: missing notificationId');
  }

  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('org_id', orgId);

  if (error) {
    throw new Error(`Failed to mark notification read: ${error.message}`);
  }

  revalidatePath('/notifications');
  // The unread-count badge is rendered by the (app) layout on every
  // navigation -- revalidating it here keeps the badge in sync with this
  // action immediately, not just after the next full page load elsewhere.
  revalidatePath('/', 'layout');
}
