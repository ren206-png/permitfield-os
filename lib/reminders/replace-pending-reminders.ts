import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlannedReminder } from './quote-reminder-schedule';

// Cancels a target's still-pending reminders and schedules the new plan, as
// the signed-in member (reminder_jobs RLS: any org member may insert a
// pending job or cancel one). Best-effort, same as the permit-expiry and
// contractor-licence scheduling: the estimate/invoice action it follows has
// already succeeded, and a scheduling failure must not undo or mask that --
// it is logged and reported back as a count only.
export async function replacePendingReminders(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    targetKind: 'estimate' | 'invoice';
    targetId: string;
    planned: PlannedReminder[];
    cancelReason: string;
  }
): Promise<{ scheduled: number }> {
  const { error: cancelError } = await supabase
    .from('reminder_jobs')
    .update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_reason: input.cancelReason })
    .eq('org_id', input.orgId)
    .eq('target_kind', input.targetKind)
    .eq('target_id', input.targetId)
    .eq('status', 'pending');
  if (cancelError) {
    console.error(`Failed to cancel pending ${input.targetKind} reminders for ${input.targetId}: ${cancelError.message}`);
  }

  if (input.planned.length === 0) return { scheduled: 0 };

  const { error: insertError } = await supabase.from('reminder_jobs').insert(
    input.planned.map((reminder) => ({
      org_id: input.orgId,
      kind: reminder.kind,
      target_kind: input.targetKind,
      target_id: input.targetId,
      send_after: reminder.sendAfter,
    }))
  );
  if (insertError) {
    console.error(`Failed to schedule ${input.targetKind} reminders for ${input.targetId}: ${insertError.message}`);
    return { scheduled: 0 };
  }
  return { scheduled: input.planned.length };
}
