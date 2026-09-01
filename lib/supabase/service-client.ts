import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service-role client for trusted server-side/background code only --
// Inngest functions, webhooks, cron. This key bypasses RLS entirely
// (SUPABASE_SERVICE_ROLE_KEY, see .env.example), which is correct for a
// background worker validating and persisting AI output across tenants, but
// it means every WHERE clause in code that uses this client is load-bearing
// -- there is no RLS backstop. Never import this from a route handler that
// acts on behalf of an end user; use lib/supabase/server.ts there so RLS
// still applies.
//
// Exception (LP workstream, Phase 3, jurisdiction SEO pages -- see
// supabase/migrations/20260806000034_public_jurisdiction_directory_read.sql's
// header for the full story, and 20260806000035_public_jurisdiction_directory_views.sql
// for a follow-up tightening): 20260806000034 is Option A of two resolution
// paths Ren was given for a real blocker (jurisdictions/permit_types were
// `authenticated`-only, no anon path). Ren replied "build both options," so
// this file is also Option B: the ONE sanctioned exception to the "never
// from an end-user route" rule above. The only caller permitted to use this
// exception is lib/jurisdictions/public-directory.ts's internal
// getReadClient(), and only when
// PERMITFIELD_JURISDICTION_DATA_STRATEGY=service-role is explicitly set
// (default is Option A, 'anon-rls', so this path is dormant unless
// deliberately turned on). What makes this safe despite the warning above:
// every query that module runs against this client -- against
// public_jurisdictions/public_permit_types, the two views 20260806000035
// added, not the base tables directly -- is a fixed, non-user-scoped
// reference-data read (jurisdiction/permit-type listings, already filtered
// to Verified/Assisted by the view itself) -- there is no request-supplied
// user id, org id, or other tenant key in any WHERE clause, so the result
// is identical for every caller and there is no per-tenant data to leak.
// That is categorically different from "a route handler that acts on
// behalf of an end user," which is what this file's opening warning is
// about. Do not use this client from any other public route without adding
// an equally explicit exception here first.
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
