import type { SupabaseClient } from '@supabase/supabase-js';

// Project facts and requirement checks are kept per project; an application
// without one gets it on first use through ensure_application_project
// (migration 20260806000102), which checks the caller's org membership
// itself. Call it only from an action that is about to write (never on a
// page render), with the caller's own session client. Returns the project
// id, or null if the application doesn't exist for this caller.
export async function ensureApplicationProject(supabase: SupabaseClient, applicationId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('ensure_application_project', { p_application_id: applicationId });
  return error ? null : (data as string);
}
