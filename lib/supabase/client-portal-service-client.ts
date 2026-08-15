import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service-role client for the SECOND, dedicated Supabase project
// (GATE_2_0_SPEC.md §0/§2 — client_access_tokens, token_lifecycle_events,
// client_access_log; local scaffold at supabase-client-portal/supabase/).
// This is a genuinely separate Postgres instance from project 1's
// lib/supabase/service-client.ts — no shared FK space, no shared extension
// or function catalog (see supabase-client-portal/supabase/migrations/
// 20260814000001's own header on both points).
//
// Distinctly named per GATE_2_0_FINDINGS.md §H.6: project 1's client used
// the generic SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_URL names
// because until Gate 2.0 there was only one project. This module and its
// env vars (CLIENT_PORTAL_SUPABASE_URL / CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY,
// see .env.example) exist specifically so project 2's credential has its own
// unambiguous slot, never colliding with or being confused for project 1's.
//
// Import boundary (§3's structural-enforcement mechanism, mechanism 1 of 2 —
// see GATE_2_0_SPEC.md §3's "Current status of the two mechanisms (K.5/L.1)"
// note: mechanism 2, credential physical isolation, cannot exist yet because
// no deploy target exists anywhere in this repo). eslint.config.mjs's
// no-restricted-imports rule enforces, at build time, that only
// lib/bridge/client-portal.ts may import this module. This is the ENTIRE
// enforced boundary today — a single, disableable, build-time convention,
// not backed by a second, independent, deployment-enforced layer. Never
// import this from a route handler, Server Action, or any other module
// acting on behalf of an end user or org staff session.
export function createClientPortalServiceClient() {
  const url = process.env.CLIENT_PORTAL_SUPABASE_URL;
  const key = process.env.CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Client-portal (project 2) service-role credentials are not configured (CLIENT_PORTAL_SUPABASE_URL / CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY).'
    );
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
