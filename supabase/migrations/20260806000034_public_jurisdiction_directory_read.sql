-- LP workstream, Phase 3 (jurisdiction SEO pages). Deliberate, user-
-- authorized exception to this workstream's own non-negotiable scope
-- boundary ("does not touch ... the database" --
-- PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md §0): while building this phase,
-- a real blocker was found and reported to Ren rather than resolved
-- unilaterally, per §7 -- jurisdictions/authorities/permit_types grant
-- SELECT to `authenticated` only (20260806000004, 20260806000005), and
-- lib/supabase/service-client.ts's own header forbids using the
-- service-role bypass from a route that acts on behalf of an end user (a
-- fully public SEO page has zero access control, unlike the one existing
-- service-role-from-a-route precedent, app/admin/page.tsx, which layers
-- auth + email allowlist + a flag on top of it). Ren was given two
-- resolution options and replied "build both options."
--
-- This migration is Option A: let the ordinary RLS-respecting client
-- (lib/supabase/server.ts, which runs unauthenticated requests as the
-- Postgres `anon` role) read this reference data directly, instead of going
-- through the service-role bypass at all. See
-- lib/supabase/service-client.ts's header for Option B (also built, dormant
-- by default) and lib/jurisdictions/public-directory.ts for the module that
-- switches between the two via PERMITFIELD_JURISDICTION_DATA_STRATEGY.
--
-- Two separate permission layers per 20260806000011_grants.sql's own
-- explicit-grants-only convention -- RLS alone is not enough, table-level
-- GRANT is a distinct requirement:
--
--  1. Table-level GRANT: 20260806000011 already granted `anon` SELECT on
--     jurisdictions (line 26 of that file, for an unrelated reason -- so an
--     anon caller gets a correct "0 rows" instead of a permission-denied
--     error). authorities and permit_types never got that grant, so they
--     need it now. Scoped to exactly these three tables -- not
--     permit_type_filings or permit_form_fields, which no public page reads.
--  2. Row-level policy: none of the three tables has a policy scoped to
--     `anon` yet (all existing policies are `to authenticated`), so even
--     jurisdictions' pre-existing anon GRANT currently resolves to zero
--     rows for an anon caller. This migration adds that policy.
--
-- Scope: read-only, and only reference/directory data that was always
-- intended to be public-facing once this phase shipped (jurisdiction names,
-- coverage tier, portal URLs, authority names, permit type titles) -- no
-- user-scoped, project-scoped, or otherwise tenant-owned table is touched.
-- No existing policy or grant is modified or dropped; this only adds
-- narrower grants/policies alongside the existing `authenticated` ones.

grant select on authorities to anon;
grant select on permit_types to anon;

create policy jurisdictions_select_anon on jurisdictions
  for select to anon
  using (true);

create policy authorities_select_anon on authorities
  for select to anon
  using (true);

create policy permit_types_select_anon on permit_types
  for select to anon
  using (true);
