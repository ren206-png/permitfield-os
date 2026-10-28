-- Gate 6, finding F1: proves 20260806000093_public_roles_no_truncate.sql.
--   1. anon and authenticated hold none of TRUNCATE / TRIGGER / REFERENCES /
--      MAINTAIN on any public table (control: the owning role does, so the
--      privilege check sees real privileges).
--   2. A table created after the migration (by postgres, like every
--      migration) does not hand those privileges to anon/authenticated, so
--      future tables are covered without a per-table revoke.
--   3. TRUNCATE itself fails for authenticated on an append-only ledger
--      (audit_logs), with a specific SQLSTATE, and the ledger keeps its rows.

begin;

-- === 1. No public table grants the four privileges to anon/authenticated ===
do $$
declare
  leaks text;
  owner_has int;
begin
  select count(*) into owner_has
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and has_table_privilege('postgres', c.oid, 'TRUNCATE');
  if owner_has = 0 then
    raise exception 'FAIL (control): postgres holds TRUNCATE on no public table, so the check below proves nothing';
  end if;

  select string_agg(format('%s:%s:%s', r.rolname, c.relname, p.priv), ', ' order by c.relname)
  into leaks
  from pg_class c
  cross join (values ('anon'), ('authenticated')) r(rolname)
  cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES'), ('MAINTAIN')) p(priv)
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and has_table_privilege(r.rolname, c.oid, p.priv);
  if leaks is not null then
    raise exception 'FAIL: public roles still hold: %', leaks;
  end if;
  raise notice 'PASS: anon/authenticated hold no TRUNCATE/TRIGGER/REFERENCES/MAINTAIN on any public table (owner holds TRUNCATE on % tables: control)', owner_has;
end $$;

-- === 2. Future tables are covered by the default-privilege change ===
create table _f1_default_privileges_probe (id int);

do $$
begin
  if not has_table_privilege('postgres', '_f1_default_privileges_probe', 'TRUNCATE') then
    raise exception 'FAIL (control): owner should hold TRUNCATE on the new probe table';
  end if;
  -- postgres's default ACL only ever granted anon/authenticated these four
  -- privileges (pg_default_acl: anon=Dxtm, authenticated=Dxtm); every table's
  -- SELECT/INSERT/... comes from its own migration's explicit grants. So
  -- after the migration a new table gives them nothing until a migration
  -- grants it.
  if has_table_privilege('anon', '_f1_default_privileges_probe', 'TRUNCATE')
     or has_table_privilege('authenticated', '_f1_default_privileges_probe', 'TRUNCATE')
     or has_table_privilege('anon', '_f1_default_privileges_probe', 'TRIGGER')
     or has_table_privilege('authenticated', '_f1_default_privileges_probe', 'TRIGGER') then
    raise exception 'FAIL: a newly created table still grants TRUNCATE/TRIGGER to anon or authenticated';
  end if;
  raise notice 'PASS: a table created after the migration gives anon/authenticated no TRUNCATE/TRIGGER (owner holds TRUNCATE: control)';
end $$;

-- === 3. TRUNCATE on an append-only ledger fails for a signed-in user ===
-- A real row first, so "the ledger keeps its rows" is not an empty-table pass.
insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner',
        'f1.truncate_probe', 'permit_applications', '40000000-0000-0000-0000-00000000000a');

do $$
declare before_count int;
begin
  select count(*) into before_count from audit_logs;
  if before_count < 1 then
    raise exception 'FAIL (control): audit_logs should hold the probe row before the TRUNCATE attempt';
  end if;
  perform set_config('f1.audit_logs_before', before_count::text, true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare blocked boolean := false;
begin
  begin
    truncate audit_logs;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: authenticated was able to TRUNCATE audit_logs';
  end if;
  raise notice 'PASS: TRUNCATE audit_logs is denied for authenticated (insufficient_privilege)';
end $$;

reset role;

do $$
declare after_count int;
begin
  select count(*) into after_count from audit_logs;
  if after_count <> current_setting('f1.audit_logs_before')::int then
    raise exception 'FAIL: audit_logs row count changed from % to %', current_setting('f1.audit_logs_before'), after_count;
  end if;
  raise notice 'PASS (control): audit_logs still holds its % row(s)', after_count;
end $$;

rollback;
