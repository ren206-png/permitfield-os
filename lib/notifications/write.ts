import type { SupabaseClient } from '@supabase/supabase-js';

// Failure-notification system (PERMITFIELD_FF_FAILURE_NOTIFICATIONS, see
// lib/flags.ts's isFailureNotificationsEnabled() header comment) --
// infrastructure for writing to the notifications ledger
// (20260806000044_notifications.sql). Sole caller today is
// lib/inngest/functions/notify-on-failure.ts, which always passes a
// service-role client (notifications has no client-facing INSERT policy --
// see that migration's header comment on why this mirrors audit_logs'
// "only a trusted background worker writes this ledger" shape).
export type NotificationKind = 'extraction_failed' | 'audit_failed' | 'document_generation_failed';

export interface NotificationEntry {
  orgId: string;
  applicationId: string;
  kind: NotificationKind;
  message: string;
}

export interface WriteNotificationResult {
  id: string;
}

// Same non-throwing shape as lib/audit/log.ts's writeAuditLog(): a failed
// ledger write must not be allowed to take down the Inngest run that was
// describing it (the run's real job -- marking the application's pipeline
// status -- already completed by the time this is called; see
// notify-on-failure.ts's step ordering). Callers decide what to do with a
// non-null `error` (notify-on-failure.ts logs and continues), this helper
// does not decide it for them by throwing.
export async function writeNotification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  entry: NotificationEntry
): Promise<{ data: WriteNotificationResult | null; error: string | null }> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      org_id: entry.orgId,
      application_id: entry.applicationId,
      kind: entry.kind,
      message: entry.message,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  if (!data) {
    return { data: null, error: 'Notification insert returned no row.' };
  }
  return { data: { id: data.id }, error: null };
}
