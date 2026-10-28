-- Gate 6, finding F1 (GATE_6_STATUS.md): anon and authenticated held
-- TRUNCATE (plus TRIGGER, REFERENCES and MAINTAIN) on 66 of 73 public
-- tables in production (read-only check, 2026-10-29), including
-- audit_logs, payments, extractions and application_status_history.
-- They came from Supabase's default privileges for tables created by
-- postgres (pg_default_acl: anon=Dxtm, authenticated=Dxtm), not from any
-- grant in this repo.
--
-- TRUNCATE skips RLS and the row-level append-only triggers
-- (forbid_update_delete/forbid_delete), so it is the one privilege that
-- could empty an append-only ledger. It was not reachable in practice --
-- both roles are NOLOGIN, PostgREST exposes no TRUNCATE, and every RPC runs
-- fixed SQL -- but it is the same "hidden default grant" class as the
-- 2026-10-11 writable public view (20260806000086), so it is closed here
-- rather than left to depend on those outer layers.
--
-- 1. Revoke TRUNCATE, TRIGGER, REFERENCES and MAINTAIN from anon and
--    authenticated on every existing public table. None of them is used by
--    either role: the app reads and writes through SELECT/INSERT/UPDATE/
--    DELETE under RLS, and triggers/foreign keys are created by migrations
--    running as postgres. service_role is untouched here (it is the trusted
--    server role; its TRUNCATE on append-only tables was already revoked
--    table by table, 20260806000033 and later).
-- 2. Change postgres's default privileges in schema public so tables created
--    by future migrations no longer hand these four privileges to anon or
--    authenticated. Only postgres's own defaults can be changed from a
--    migration (supabase_admin's are outside its reach); every table in this
--    repo is created by postgres (verified: 0 public tables owned by any
--    other role on a fresh local reset, 2026-10-29).
--
-- ROLLBACK (restores the previous, wider privileges -- not recommended):
--   alter default privileges for role postgres in schema public
--     grant truncate, references, trigger, maintain on tables to anon, authenticated;
--   do $$ declare r record; begin
--     for r in select c.oid::regclass as t from pg_class c
--              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
--       execute format('grant truncate, references, trigger, maintain on %s to anon, authenticated', r.t);
--     end loop; end $$;

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger, maintain on %s from anon, authenticated', r.tbl);
  end loop;
end $$;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
