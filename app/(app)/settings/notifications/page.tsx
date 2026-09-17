import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isNotificationsEnabled } from '@/lib/flags';
import { createClient } from '@/lib/supabase/server';
import { NotificationToggleButton } from './notification-toggle-button';

// Gate 5, sub-phase 5.3 hardening (per-user opt-out, per Ren's explicit
// "1-4 matters to me please work on it" instruction). Self-service
// settings page for notification_preferences (20260806000048...sql) --
// same "flag off means this route 404s" discipline as
// app/(app)/settings/billing/page.tsx's own isBillingEnabled() gate, since
// a preference toggle with notifications disabled entirely would have no
// observable effect for the user to verify (lib/inngest/functions/notify.ts's
// permitNotify returns `skipped: 'flag_off'` before ever consulting this
// table).
//
// Unlike billing, there is no owner/member distinction here at all --
// notification_preferences is scoped to (org_id, user_id), and
// resolveOrgNotificationRecipients() (lib/notifications/recipients.ts)
// notifies every org_members row regardless of role, so every member
// (owner or not) gets the exact same self-service toggle for their own
// row only. RLS (user_id = auth.uid()) enforces that a member can only
// ever see/change their own preference, never another member's -- this
// page's own query is scoped the same way as defense in depth, not as
// the real gate.
export default async function NotificationsSettingsPage() {
  if (!isNotificationsEnabled()) {
    notFound();
  }

  const { userId, orgId } = await requireOrgContext();
  const supabase = await createClient();

  const { data: preference, error } = await supabase
    .from('notification_preferences')
    .select('email_enabled')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load notification preferences: ${error.message}`);
  }

  // ABSENCE MEANS ENABLED -- see 20260806000048_notification_preferences.sql
  // and lib/notifications/recipients.ts's own header comments for why a
  // missing row (every member as of this migration, and any member who
  // never visits this page) reads as "notify me", not "don't notify me".
  const emailEnabled = preference?.email_enabled ?? true;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Notifications</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Choose whether you receive email updates when one of your organization&#39;s applications changes state
        (extraction, audit, document generation, or drawing review).
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900">Email notifications</p>
            <p className="text-xs text-zinc-500">
              {emailEnabled
                ? 'You are currently receiving email updates for this organization.'
                : 'You have turned off email updates for this organization.'}
            </p>
          </div>
          <NotificationToggleButton emailEnabled={emailEnabled} />
        </div>
      </div>
    </div>
  );
}
