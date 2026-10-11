-- Regression guard for 20260806000086_public_directory_views_read_only.sql.
-- Proves:
--   1. No view in the public schema grants INSERT, UPDATE, DELETE or
--      TRUNCATE to anon or authenticated (a view owned by postgres with
--      security_invoker = false writes as its owner, past RLS).
--   2. anon can still read both public directory views.
--   3. An anonymous update through public_jurisdictions is refused.

begin;

do $$
declare
  v_leaks text;
begin
  select string_agg(distinct c.relname || ' (' || r.rolname || ' ' || p.priv || ')', ', ')
  into v_leaks
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
  where n.nspname = 'public'
    and c.relkind in ('v', 'm')
    and has_table_privilege(r.rolname, c.oid, p.priv);
  if v_leaks is not null then
    raise exception 'FAIL: writable view(s): %', v_leaks;
  end if;
  raise notice 'PASS: no public view is writable by anon or authenticated.';
end $$;

set local role anon;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public_jurisdictions;
  select count(*) into v_count from public_permit_types;
  raise notice 'PASS: anon can read both public directory views.';
end $$;

do $$
begin
  update public_jurisdictions set portal_url = 'https://example.invalid';
  raise exception 'FAIL: anon updated public_jurisdictions';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot update public_jurisdictions.';
end $$;

reset role;

rollback;
