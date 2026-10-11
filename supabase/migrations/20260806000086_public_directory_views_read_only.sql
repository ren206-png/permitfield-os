-- Security fix: public_jurisdictions and public_permit_types were writable
-- by anyone holding the public anon key.
--
-- 20260806000035 created both views with security_invoker = false (they run
-- as their owner, bypassing RLS, so anon can read the safe column subset
-- without a grant on the base tables) and granted SELECT to anon. But
-- Supabase's default privileges on the public schema had already granted
-- ALL (INSERT, UPDATE, DELETE, TRUNCATE...) to anon and authenticated when
-- the views were created. public_jurisdictions is a single-table view, so
-- Postgres makes it auto-updatable: an anonymous PATCH or DELETE to
-- /rest/v1/public_jurisdictions ran as the view owner against jurisdictions,
-- with no RLS in the way (confirmed in production 2026-10-11 with a request
-- that matched no rows). public_permit_types is a join, so not updatable,
-- but it carried the same grants.
--
-- Both views are read paths only: revoke everything, then grant SELECT back
-- to the roles that read them (lib/jurisdictions/public-directory.ts reads
-- as anon, or as authenticated when the visitor is signed in).

revoke all on public_jurisdictions from public, anon, authenticated;
revoke all on public_permit_types from public, anon, authenticated;

grant select on public_jurisdictions to anon, authenticated, service_role;
grant select on public_permit_types to anon, authenticated, service_role;
