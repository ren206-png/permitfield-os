import type { SupabaseClient } from '@supabase/supabase-js';

// Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K). Recipient resolution for
// the notification-sending Inngest subscriber (lib/inngest/functions/
// notify.ts).
//
// SCOPE DECISION: internal/staff (org_members) only, not the external/
// client-portal recipient path (client_access_tokens.recipient_email in
// the second, dedicated Supabase project -- see GATE_5_FINDINGS.md §F).
// That path requires the cross-project bridge (lib/bridge/client-portal.ts,
// lint-enforced boundary per GATE_2_0_SPEC.md §3) and a product decision
// about which lifecycle events an external client should even see (an
// audit finding or a drawing-review result is internal/staff-facing review
// material, not obviously something to email a client directly). Neither
// was resolved as in-scope for this sub-phase, so it's deferred rather than
// guessed at -- same "declare now, decide later" discipline as everything
// else in this workstream. Every org_members row (both 'owner' and
// 'member' roles) is notified, not just 'owner' -- an application's
// lifecycle events are relevant to whoever is working the application, not
// only the org's billing-accountable owner.
//
// auth.users is not exposed to PostgREST, so email lookup goes through the
// Supabase Admin API (supabase.auth.admin.getUserById), same mechanism as
// app/admin/page.tsx's listAllUsers() helper -- getUserById per member
// here rather than a single listUsers() page, since a single org's
// membership is typically far smaller than the 1000-row page size that
// helper exists to work around.

export interface NotificationRecipient {
  userId: string;
  email: string;
}

/**
 * Resolves every org_members row for orgId into a notifiable
 * (userId, email) pair. Skips (does not throw for) any member whose
 * auth.users lookup fails or has no email on file -- one missing/deleted
 * account must never block every other member's notification, mirroring
 * this codebase's fail-closed-per-item (not fail-closed-per-batch)
 * discipline (e.g. audit.ts's per-finding validation).
 */
export async function resolveOrgNotificationRecipients(
  supabase: SupabaseClient,
  orgId: string
): Promise<NotificationRecipient[]> {
  const { data: members, error } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId);
  if (error) {
    throw new Error(`Failed to load org_members for ${orgId}: ${error.message}`);
  }

  // Gate 5, sub-phase 5.3 hardening (per-user opt-out). Loaded once per org,
  // not per member -- one query here versus N is the same batching
  // reasoning as every other per-org resolution step in this codebase.
  // ABSENCE MEANS ENABLED: a member with no notification_preferences row at
  // all (every member as of this migration, and any member who never visits
  // the settings page after) is NOT in this set and is notified exactly as
  // before -- see 20260806000049_notification_preferences.sql's own header
  // comment on why this default is deliberately opt-out-by-exception, not
  // opt-in-by-default.
  const { data: preferences, error: preferencesError } = await supabase
    .from('notification_preferences')
    .select('user_id, email_enabled')
    .eq('org_id', orgId)
    .eq('email_enabled', false);
  if (preferencesError) {
    throw new Error(`Failed to load notification_preferences for ${orgId}: ${preferencesError.message}`);
  }
  const optedOutUserIds = new Set((preferences ?? []).map((p) => p.user_id as string));

  const recipients: NotificationRecipient[] = [];
  for (const member of members ?? []) {
    const userId = member.user_id as string;
    if (optedOutUserIds.has(userId)) {
      continue;
    }
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData?.user?.email) {
      continue;
    }
    recipients.push({ userId, email: userData.user.email });
  }
  return recipients;
}
