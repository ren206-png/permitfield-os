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
//
// Exception 2 (Gate 4, Quotes & Payments, Phase A -- public estimate/invoice
// view + PDF routes, app/estimate/[token]/, app/invoice/[token]/, and their
// api/public/.../pdf siblings): these routes serve an anonymous, bearer-
// token-holding client, not an authenticated end user, so there is no
// Supabase Auth session (and therefore no RLS-enforcing session client,
// lib/supabase/server.ts) available to them at all -- the same structural
// reason lib/bridge/client-portal.ts's own client-facing operations already
// use this exact client for their project-1 reads. What makes each read
// safe despite bypassing RLS: every one of these routes calls
// lib/bridge/client-portal.ts's `resolveTargetToken()` FIRST, and only
// constructs this client (or proceeds to use one already constructed) with
// the `orgId`/`targetId` THAT CALL RETURNED -- never with a request-supplied
// org id or estimate/invoice id -- and every subsequent query is explicitly
// scoped with `.eq('org_id', orgId).eq('id', targetId)` using those
// server-verified values. That is the same "validated pointer, not a
// trusted-caller-supplied one" discipline `loadScopedApplication()` already
// applies one file over; it is being restated here, not re-decided, because
// this file's own rule above requires a new exception to be spelled out
// explicitly rather than silently added to. Do not read any OTHER table
// from these routes without narrowing the scoping the same way.
//
// Exception 3 (Public API v1, app/api/v1/*): same structural reason as
// Exception 2 -- the caller holds an API key, not a Supabase Auth session.
// Only lib/public-api/handler.ts constructs this client for those routes,
// and it resolves `orgId` solely from the org_api_keys row the presented
// key's SHA-256 hash matches (never from the request). Every data query in
// lib/public-api/resources.ts is then filtered `.eq('org_id', orgId)` with
// that server-derived value. New v1 endpoints must go through
// handleApiRequest() and keep that filter on every query.
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
