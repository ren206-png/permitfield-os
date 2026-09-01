-- LP workstream, Phase 3 follow-up. Tightens the public read path added in
-- 20260806000034 after a self-review (prompted directly by Ren) found two
-- real gaps in that migration, not hypothetical ones:
--
--  1. Its anon RLS policies were `using (true)` on the base tables --
--     meaning anon could read every row directly via the Supabase REST API
--     (PostgREST, using the public anon key already shipped in the client
--     bundle), not just the Verified/Assisted, has-content rows the public
--     pages actually render. lib/jurisdictions/public-directory.ts's
--     coverage_level filter is application-layer curation, not a database
--     guarantee -- a visitor who bypassed the app and hit PostgREST
--     directly saw the full table, including `listed` jurisdictions and
--     every permit_types row regardless of jurisdiction.
--  2. It granted anon SELECT on `authorities` for a page that never reads
--     that table -- grepped lib/jurisdictions/public-directory.ts and both
--     app/coverage/ and app/permits/: zero references. Unused exposure,
--     not a deliberate one.
--
-- Fix: two narrow views, each pre-filtered to exactly what the public pages
-- are allowed to show, with anon (and service_role, for code-path
-- unification -- see below) granted SELECT on the views only, never on the
-- base tables. The prior base-table anon grants/policies from
-- 20260806000034 are revoked/dropped below, not left dangling alongside
-- this narrower path -- per this migration file's own additive-only
-- convention, that means a new migration correcting a previous one (same
-- pattern as 20260806000015 correcting 20260806000011's wrong claim about
-- service_role), not an edit to 20260806000034 itself.
--
-- Deliberately relies on Postgres's default (non-security_invoker) view
-- behavior, made explicit below rather than left as an implicit default:
-- this view's owner is the migration role that owns jurisdictions/
-- permit_types (standard Supabase migration execution -- a superuser/
-- table-owner role, exempt from RLS on tables it owns), so the view itself
-- can read the full base tables and return only the pre-filtered rows to
-- whichever role queries the view. anon and service_role never get a grant
-- on the base tables through this path at all -- only on these two views.
-- This is the "security definer view" pattern Supabase's own linter warns
-- about in general; it is intentional and narrow here (two read-only
-- views, a fixed WHERE clause, no parameters, no write path) -- the
-- opposite problem 20260806000014's search_jurisdiction_code_chunks RPC
-- comment addresses (that RPC deliberately avoided this pattern because it
-- needed RLS layered on top of its own filter). These views don't need
-- that layering, because their WHERE clause IS the entire intended access
-- boundary, not a supplement to a separate one.

revoke select on authorities from anon;
drop policy if exists jurisdictions_select_anon on jurisdictions;
drop policy if exists authorities_select_anon on authorities;
drop policy if exists permit_types_select_anon on permit_types;
revoke select on jurisdictions from anon;
revoke select on permit_types from anon;

create view public_jurisdictions
  with (security_invoker = false)
  as
  select id, province_code, municipality, region, coverage_level, portal_url
  from jurisdictions
  where coverage_level in ('verified', 'assisted');

-- Joins against jurisdictions (not against public_jurisdictions) so this
-- view's own WHERE clause is self-contained and doesn't depend on the
-- other view's definition staying in sync with it.
create view public_permit_types
  with (security_invoker = false)
  as
  select pt.id, pt.jurisdiction_id, pt.title, pt.verified_at
  from permit_types pt
  join jurisdictions j on j.id = pt.jurisdiction_id
  where j.coverage_level in ('verified', 'assisted');

-- service_role already has direct SELECT on the base tables
-- (20260806000015, for the Inngest extract/audit functions) -- granting it
-- on these views too is purely so
-- lib/jurisdictions/public-directory.ts's 'service-role' strategy (Option
-- B, dormant by default -- see lib/supabase/service-client.ts's header) can
-- run the exact same query shape as the 'anon-rls' default, not a widening
-- of what service_role can already reach.
grant select on public_jurisdictions to anon, service_role;
grant select on public_permit_types to anon, service_role;
