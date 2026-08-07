import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service-role client for trusted server-side/background code only --
// Inngest functions, webhooks, cron. This key bypasses RLS entirely
// (SUPABASE_SERVICE_ROLE_KEY, see .env.example), which is correct for a
// background worker validating and persisting AI output across tenants, but
// it means every WHERE clause in code that uses this client is load-bearing
// -- there is no RLS backstop. Never import this from a route handler that
// acts on behalf of an end user; use lib/supabase/server.ts there so RLS
// still applies.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase service-role credentials are not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).'
    );
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
