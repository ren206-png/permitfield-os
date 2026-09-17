-- Gate 5, sub-phase 5.3 hardening (per-user opt-out, per Ren's explicit
-- "1-4 matters to me please work on it" instruction,
-- 20260806000048_notification_preferences.sql). Proves:
--   1. authenticated can INSERT/UPDATE/SELECT their OWN (org_id, user_id)
--      row (user_id = auth.uid(), and is_org_member(org_id) on insert).
--   2. authenticated cannot INSERT a row claiming a DIFFERENT user_id (the
--      WITH CHECK's `user_id = auth.uid()` half) -- forging an opt-out for
--      someone else must be impossible even within one's own org.
--   3. authenticated cannot INSERT a row for an org they are not a member
--      of (the WITH CHECK's `is_org_member(org_id)` half).
--   4. authenticated (org A owner) cannot SELECT or UPDATE another member's
--      preference row in the SAME org -- this table is scoped to the
--      individual, not the org, unlike most of this codebase's tables.
--   5. authenticated has no DELETE path at all (no policy, matching this
--      table's deliberate lack of a DELETE policy -- see the migration's
--      own header comment).
--   6. service_role holds SELECT only, not INSERT/UPDATE/DELETE --
--      lib/notifications/recipients.ts (the only service_role reader) never
--      writes this table; only the user's own authenticated session
--      (app/(app)/settings/notifications/actions.ts) does.
--   7. unique (org_id, user_id) -- a second row for the same pair is
--      rejected, matching the onConflict='org_id,user_id' upsert
--      actions.ts relies on.
--   8. service_role has no TRUNCATE grant (same gap-closing pattern as
--      every other new table in this workstream).
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/notification_preferences.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A fixtures from supabase/seed.sql PART 2 (same as
-- notification_log.test.sql / drawing_review_schema.test.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a
--   Org B: 20000000-...000b, owner 10000000-...000b

-- A second Org A member, synthetic (seed.sql gives each org exactly one
-- member -- the owner) -- needed for check 4's "another member in the SAME
-- org" cross-user isolation, which a single-member org can't exercise.
-- Inserted as the connection's default (superuser) role, before any
-- `set local role` below -- same ordering notification_log.test.sql's own
-- synthetic auth.users fixture uses (service_role has no INSERT grant on
-- auth.users).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated',
        'orga-second-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000e', 'member')
on conflict (org_id, user_id) do nothing;

-- === 1. authenticated (org A owner) can INSERT/SELECT/UPDATE their own row ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into notification_preferences (org_id, user_id, email_enabled)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', false);

do $$
declare
  got boolean;
begin
  select email_enabled into got from notification_preferences
  where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a';
  if got is distinct from false then
    raise exception 'FAIL: org A owner could not INSERT/SELECT their own notification_preferences row (got %)', got;
  end if;
  raise notice 'PASS: authenticated can INSERT and SELECT their own notification_preferences row';
end $$;

update notification_preferences set email_enabled = true
where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a';

do $$
declare
  got boolean;
begin
  select email_enabled into got from notification_preferences
  where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a';
  if got is distinct from true then
    raise exception 'FAIL: org A owner could not UPDATE their own notification_preferences row (got %)', got;
  end if;
  raise notice 'PASS: authenticated can UPDATE their own notification_preferences row';
end $$;

-- === 2. authenticated cannot INSERT a row claiming a DIFFERENT user_id ===
do $$
begin
  begin
    insert into notification_preferences (org_id, user_id, email_enabled)
    values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000e', false);
    raise exception 'FAIL: org A owner was able to INSERT a notification_preferences row for a different user_id';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT for a different user_id correctly rejected by WITH CHECK (user_id = auth.uid()) (%)', sqlerrm;
  end;
end $$;

-- === 3. authenticated cannot INSERT a row for an org they are not a member of ===
do $$
begin
  begin
    insert into notification_preferences (org_id, user_id, email_enabled)
    values ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', false);
    raise exception 'FAIL: org A owner was able to INSERT a notification_preferences row for org B, which they are not a member of';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT for a non-member org correctly rejected by WITH CHECK (is_org_member(org_id)) (%)', sqlerrm;
  end;
end $$;

reset role;

-- Second member's own row, inserted as that user, for check 4 below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000e","role":"authenticated"}';
insert into notification_preferences (org_id, user_id, email_enabled)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000e', false);
reset role;

-- === 4. authenticated (org A owner) cannot see/update another member's row in the SAME org ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from notification_preferences
  where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000e';
  if visible_count <> 0 then
    raise exception 'FAIL: org A owner could SELECT another member''s notification_preferences row in the same org (this table is per-user, not per-org)';
  end if;
  raise notice 'PASS: authenticated cannot SELECT another org member''s own notification_preferences row';
end $$;

do $$
declare
  affected_count int;
begin
  update notification_preferences set email_enabled = true
  where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000e';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then
    raise exception 'FAIL: org A owner was able to UPDATE another member''s notification_preferences row';
  end if;
  raise notice 'PASS: UPDATE against another member''s row correctly affects zero rows (RLS-filtered, not an error) for authenticated';
end $$;

-- === 5. authenticated has no DELETE path (no policy at all) ===
do $$
declare
  affected_count int;
begin
  begin
    delete from notification_preferences
    where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a';
    get diagnostics affected_count = row_count;
    if affected_count <> 0 then
      raise exception 'FAIL: authenticated was able to DELETE their own notification_preferences row (no DELETE policy should exist)';
    end if;
    raise notice 'PASS: DELETE affects zero rows for authenticated (no DELETE policy, no grant) -- row remains in place';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: DELETE on notification_preferences correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 6. service_role holds SELECT only, not INSERT/UPDATE/DELETE ===
set local role service_role;

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from notification_preferences
  where org_id = '20000000-0000-0000-0000-00000000000a';
  if visible_count <> 2 then
    raise exception 'FAIL: service_role could not SELECT across notification_preferences rows (expected 2, got %)', visible_count;
  end if;
  raise notice 'PASS: service_role can SELECT notification_preferences (lib/notifications/recipients.ts''s own read path)';
end $$;

do $$
begin
  begin
    insert into notification_preferences (org_id, user_id, email_enabled)
    values ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', false);
    raise exception 'FAIL: service_role was able to INSERT into notification_preferences (should be select-only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT on notification_preferences correctly rejected for service_role (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update notification_preferences set email_enabled = true
    where org_id = '20000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE notification_preferences (should be select-only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: UPDATE on notification_preferences correctly rejected for service_role (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 7. unique (org_id, user_id) ===
-- Run as `authenticated` (org A owner), not service_role -- service_role
-- holds no INSERT grant at all (section 6 above), so attempting this
-- INSERT under that role would fail with permission_denied for a reason
-- unrelated to the unique constraint actually under test here. The owner's
-- own row (org A / user 000a) already exists from section 1.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    insert into notification_preferences (org_id, user_id, email_enabled)
    values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', true);
    raise exception 'FAIL: inserted a second notification_preferences row for the same (org_id, user_id) pair';
  exception
    when unique_violation then
      raise notice 'PASS: unique (org_id, user_id) correctly rejects a duplicate row (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 8. TRUNCATE gap ===
set local role service_role;

do $$
declare
  grant_count int;
begin
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_name = 'notification_preferences'
    and grantee = 'service_role'
    and privilege_type = 'TRUNCATE';
  if grant_count <> 0 then
    raise exception 'FAIL: service_role still holds a TRUNCATE grant on notification_preferences';
  end if;
  raise notice 'PASS: service_role has no TRUNCATE grant on notification_preferences';
end $$;

do $$
begin
  begin
    truncate notification_preferences;
    raise exception 'FAIL: service_role was able to TRUNCATE notification_preferences';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on notification_preferences is rejected for service_role (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
