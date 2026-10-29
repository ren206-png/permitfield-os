import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service-client';

// Live tests only (local / CI stacks). Signs in as one of the supabase/seed.sql
// PART 2 fixture owners. Every live test file uses the same fixed password
// per user, so files that run in parallel never overwrite each other's
// credentials. These users exist only in local and CI databases.

export const SEED_OWNERS = {
  orgA: { orgId: '20000000-0000-0000-0000-00000000000a', userId: '10000000-0000-0000-0000-00000000000a' },
  orgB: { orgId: '20000000-0000-0000-0000-00000000000b', userId: '10000000-0000-0000-0000-00000000000b' },
} as const;

export async function signInSeedOwner(userId: string): Promise<SupabaseClient> {
  const password = `live-test-${userId}`;
  const { data: updated, error } = await createServiceClient().auth.admin.updateUserById(userId, { password });
  if (error || !updated.user?.email) throw new Error(`updateUserById failed: ${error?.message}`);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email: updated.user.email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return client;
}
