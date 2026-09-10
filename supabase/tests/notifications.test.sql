-- Failure-notification system (PERMITFIELD_FF_FAILURE_NOTIFICATIONS).
-- Proves, against the actual `authenticated`/`service_role` Postgres roles
-- under RLS (not just "the UI doesn't show a button for it"), everything
-- 20260806000044_notifications.sql adds:
--   1. Tenant isolation: Org B cannot read Org A's notifications row; Org A
--      can read its own.
--   2. `authenticated` cannot INSERT a notifications row (no insert policy
--      for that role at all) -- only `service_role` can, matching
--      lib/notifications/write.ts's writeNotification() being called
--      exclusively from lib/inngest/functions/notify-on-failure.ts with a
--      service-role client.
--   3. An org member CAN mark their own org's notification read (UPDATE
--      read_at) -- any member, not a narrower role, matching this
--      migration's "informational, not a workflow-tier action" header
--      comment. A different org's member cannot (RLS silently filters the
--      row out of the UPDATE, 0 rows affected, row unchanged -- same
--      "filtered, not rejected" shape readiness_checklist.test.sql's own
--      role-matrix assertions document for a non-owner DELETE).
--   4. The `kind` CHECK constraint rejects a value outside the three
--      failure kinds this system actually emits.
--   5. The composite (org_id, application_id) FK rejects a row whose
--      application_id doesn't actually belong to org_id -- the same
--      integrity guarantee readiness_checklist_items' own composite FK
--      gives, proven here rather than just cited.
--
-- HOW TO RUN:
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/notifications.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh). Also runs automatically on every push/PR
-- via .github/workflows/ci.yml's sql-tests job.

begin;

-- Reuses Org A/B owner fixtures and each org's own seeded draft application
-- from supabase/seed.sql PART 2:
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a /
--     application 40000000-0000-0000-0000-00000000000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b /
--     application 40000000-0000-0000-0000-00000000000b
-- No new permit_applications fixture rows needed -- these two already exist
-- and already satisfy the composite (org_id, id) FK this table's own
-- (org_id, application_id) FK references.

-- Seed one notifications row per org as service_role (bypasses RLS entirely
-- -- proves nothing about RLS itself, this is fixture setup mirroring
-- readiness_checklist.test.sql/audit_logs.test.sql's own "seed as
-- service_role, then test as authenticated" split).
set local role service_role;

insert into notifications (id, org_id, application_id, kind, message)
values
  ('60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '40000000-0000-0000-0000-00000000000a', 'extraction_failed', 'Org A Test Project: extraction failed.'),
  ('60000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '40000000-0000-0000-0000-00000000000b', 'audit_failed', 'Org B Test Project: audit failed.');

reset role;

-- === 1. Tenant isolation: Org B cannot read Org A's notifications row ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from notifications where id = '60000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL: Org B member could read Org A''s notification (tenant isolation broken)';
  end if;
  raise notice 'PASS: Org B member cannot read Org A''s notification';
end $$;

-- === 1b. Org A can read its own notification ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from notifications where id = '60000000-0000-0000-0000-00000000000a';
  if v_count <> 1 then
    raise exception 'FAIL: Org A member could not read its own org''s notification (expected 1, got %)', v_count;
  end if;
  raise notice 'PASS: Org A member can read its own org''s notification';
end $$;

-- === 2. authenticated cannot INSERT a notifications row ===
do $$
begin
  insert into notifications (org_id, application_id, kind, message)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
          'extraction_failed', 'should never be insertable by authenticated');
  raise exception 'FAIL: authenticated was able to INSERT a notifications row (should be service_role only)';
exception
  -- Deliberately NOT "or others" here (unlike
  -- ai_jobs_ledger_human_reviews.test.sql's own version of this same
  -- assertion) -- `others` would also match the `raise exception 'FAIL...'`
  -- line immediately above on the success path, silently turning a real
  -- test failure into a printed PASS. RLS rejecting an INSERT with no
  -- matching policy reliably raises 42501 (insufficient_privilege,
  -- "new row violates row-level security policy"), so matching that one
  -- condition precisely is both sufficient and safer.
  when insufficient_privilege then
    raise notice 'PASS: authenticated correctly rejected from INSERT on notifications (%)', sqlerrm;
end $$;

-- === 3. An org member can mark their own org's notification read ===
update notifications set read_at = now() where id = '60000000-0000-0000-0000-00000000000a';

do $$
declare
  v_read_at timestamptz;
begin
  select read_at into v_read_at from notifications where id = '60000000-0000-0000-0000-00000000000a';
  if v_read_at is null then
    raise exception 'FAIL: Org A member''s UPDATE of read_at on its own notification did not take effect';
  end if;
  raise notice 'PASS: Org A member can mark its own org''s notification read';
end $$;

-- === 3b. Org A member cannot mark Org B's notification read (filtered, not rejected) ===
do $$
declare
  v_row_count int;
  v_read_at timestamptz;
begin
  update notifications set read_at = now() where id = '60000000-0000-0000-0000-00000000000b';
  get diagnostics v_row_count = row_count;
  if v_row_count <> 0 then
    raise exception 'FAIL: Org A member''s UPDATE reached Org B''s notification row (% rows affected)', v_row_count;
  end if;
end $$;

-- === 4. kind CHECK constraint rejects an unrecognized value ===
set local role service_role;

do $$
begin
  insert into notifications (org_id, application_id, kind, message)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
          'not_a_real_kind', 'should be rejected by the kind check constraint');
  raise exception 'FAIL: notifications.kind accepted a value outside the three documented failure kinds';
exception
  when check_violation then
    raise notice 'PASS: notifications.kind correctly rejects an unrecognized value (%)', sqlerrm;
end $$;

-- === 5. Composite (org_id, application_id) FK rejects a mismatched pair ===
do $$
begin
  insert into notifications (org_id, application_id, kind, message)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b',
          'extraction_failed', 'Org A id paired with Org B''s application -- should violate the composite FK');
  raise exception 'FAIL: notifications accepted an application_id that does not belong to org_id (composite FK not enforced)';
exception
  when foreign_key_violation then
    raise notice 'PASS: composite (org_id, application_id) FK correctly rejects a mismatched pair (%)', sqlerrm;
end $$;

reset role;

rollback;
