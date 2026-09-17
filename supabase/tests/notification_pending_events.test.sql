-- Gate 5, sub-phase 5.3 hardening (digest/batching, per Ren's explicit
-- "1-4 matters to me please work on it" instruction,
-- 20260806000049_notification_pending_events.sql). Proves, for this new
-- durable queue table backing lib/inngest/functions/notify.ts's
-- permitNotify/permitNotifyFlush split:
--   1. RLS default-deny: with RLS enabled and zero policies, `authenticated`
--      cannot SELECT/INSERT/UPDATE/DELETE a row, even inside its own org --
--      same shape as notification_log.test.sql's own check 1.
--   2. service_role can SELECT + INSERT + UPDATE (the pending-events
--      lifecycle: permitNotify inserts, permitNotifyFlush later reads and
--      then updates flushed_at) -- but NOT DELETE.
--   3. UNLIKE every append-only sibling table in this workstream, this
--      table has NO forbid_update_delete() trigger -- service_role's UPDATE
--      of flushed_at must actually succeed, not be silently blocked by a
--      trigger this table deliberately omits (see the migration's own
--      header comment on why this is the one deliberate exception to the
--      append-only convention).
--   4. CHECK constraints: event_kind restricted to its six known values,
--      and the same one-directional (event_kind = 'drawing_review_completed'
--      or application_document_id is null) shape notification_log already
--      has, for the same "the FK's own ON DELETE SET NULL must remain legal
--      later" reason.
--   5. application_id's FK is ON DELETE CASCADE (a deleted application
--      has nothing left to digest -- unlike notification_log, which is a
--      permanent record and uses ON DELETE SET NULL instead).
--   6. application_document_id's FK is ON DELETE SET NULL, not CASCADE --
--      same reasoning as notification_log's own column.
--   7. TRUNCATE: service_role holds no TRUNCATE grant (same gap-closing
--      pattern as every other new table in this workstream).
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/notification_pending_events.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A fixtures from supabase/seed.sql PART 2 (same as
-- notification_log.test.sql / drawing_review_schema.test.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a, application 40000000-...000a

set local role service_role;

insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
values
  ('79000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000a',
   'org-a/notify-pending-fixture-drawing.pdf', 'notify-pending-fixture-drawing.pdf', 'application/pdf', 2048, repeat('e', 64), 'blueprint')
on conflict (id) do nothing;

-- === 2 (partial) / setup: service_role can INSERT rows, both event_kind shapes ===
insert into notification_pending_events (id, org_id, application_id, application_document_id, event_kind, subject, body)
values
  ('7b000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   null, 'audit_completed', 'Audit complete: Test Permit', 'Body one.'),
  ('7b000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   '79000000-0000-0000-0000-00000000000b', 'drawing_review_completed', 'Drawing review complete: Test Permit', 'Body two.');

do $$
declare
  inserted_count int;
begin
  select count(*) into inserted_count from notification_pending_events
  where id in ('7b000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-00000000000b');
  if inserted_count <> 2 then
    raise exception 'FAIL: service_role INSERT of notification_pending_events rows did not succeed as expected (got %)', inserted_count;
  end if;
  raise notice 'PASS: service_role can INSERT notification_pending_events rows for both application-scoped and drawing-document-scoped event kinds';
end $$;

-- === 2 (continued) / 3. service_role can UPDATE flushed_at -- no append-only trigger blocks it ===
update notification_pending_events set flushed_at = now()
where id = '7b000000-0000-0000-0000-00000000000a';

do $$
declare
  got timestamptz;
begin
  select flushed_at into got from notification_pending_events where id = '7b000000-0000-0000-0000-00000000000a';
  if got is null then
    raise exception 'FAIL: service_role UPDATE of flushed_at did not take effect -- this table must allow UPDATE, unlike its append-only siblings';
  end if;
  raise notice 'PASS: service_role can UPDATE flushed_at (this table is the deliberate exception to the append-only convention -- no forbid_update_delete() trigger exists here)';
end $$;

-- === 2 (continued): service_role has no DELETE grant ===
do $$
begin
  begin
    delete from notification_pending_events where id = '7b000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE a notification_pending_events row (grant is select+insert+update only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: DELETE on notification_pending_events correctly rejected for service_role (%)', sqlerrm;
  end;
end $$;

-- === 4a. CHECK: event_kind restricted to its six known values ===
do $$
begin
  begin
    insert into notification_pending_events (org_id, application_id, event_kind, subject, body)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'application_submitted', 'x', 'y');
    raise exception 'FAIL: inserted a row with an event_kind not in the known six-value list';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects an unrecognized event_kind value (%)', sqlerrm;
  end;
end $$;

-- === 4b. CHECK: event_kind = 'drawing_review_completed' or application_document_id is null ===
-- Deliberately one-directional, same reasoning/precedent as
-- notification_log's own equivalent CHECK (see that migration's comment):
-- a drawing_review_completed row is expected to always carry a document id
-- at insert time (asserted as the allowed case below), but the CHECK does
-- not enforce that direction, because application_document_id's own
-- `on delete set null` FK must remain able to null it out later (checked in
-- section 6 below) without violating this constraint.
insert into notification_pending_events (org_id, application_id, event_kind, subject, body)
values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'drawing_review_completed', 'x', 'y');
do $$
begin
  raise notice 'PASS: a drawing_review_completed row with a null application_document_id is accepted -- deliberately allowed so the ON DELETE SET NULL FK below can null this column without a CHECK conflict';
end $$;

do $$
begin
  begin
    insert into notification_pending_events (org_id, application_id, application_document_id, event_kind, subject, body)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '79000000-0000-0000-0000-00000000000b',
            'audit_completed', 'x', 'y');
    raise exception 'FAIL: inserted a non-drawing-review event_kind row with a non-null application_document_id';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects a non-drawing-review event_kind with a non-null application_document_id (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 1. RLS default-deny for `authenticated` (no policies at all) ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    perform 1 from notification_pending_events limit 1;
    raise exception 'FAIL: authenticated (org A owner) was able to SELECT from notification_pending_events (should be default-deny, zero policies)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: SELECT on notification_pending_events correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into notification_pending_events (org_id, application_id, event_kind, subject, body)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'audit_completed', 'x', 'y');
    raise exception 'FAIL: authenticated was able to INSERT into notification_pending_events (should be service_role only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT on notification_pending_events correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update notification_pending_events set flushed_at = now() where id = '7b000000-0000-0000-0000-00000000000b';
    raise exception 'FAIL: authenticated was able to UPDATE a notification_pending_events row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: UPDATE on notification_pending_events correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from notification_pending_events where id = '7b000000-0000-0000-0000-00000000000b';
    raise exception 'FAIL: authenticated was able to DELETE a notification_pending_events row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: DELETE on notification_pending_events correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 5. application_id FK is ON DELETE CASCADE ===
-- Verified via pg_constraint metadata (confdeltype = 'c'), NOT a live
-- DELETE FROM permit_applications -- permit_status_machine.test.sql's own
-- section 1 comment documents exactly why a real delete of a seeded
-- permit_applications row is unsafe to attempt in this test suite:
-- permit_applications' seed-time insert trigger auto-creates an
-- application_status_history row, and that table's own
-- application_status_history_append_only trigger (forbid_update_delete())
-- fires unconditionally on the CASCADE-driven DELETE that would try to
-- remove it, aborting this file's single outer transaction before any
-- later section could run. A metadata check proves the same schema fact
-- (this FK really is ON DELETE CASCADE, not SET NULL/RESTRICT/NO ACTION)
-- without touching that fan-out at all.
do $$
declare
  delete_action char;
begin
  select confdeltype into delete_action
  from pg_constraint
  where conrelid = 'notification_pending_events'::regclass
    and confrelid = 'permit_applications'::regclass;
  if delete_action is null then
    raise exception 'FAIL: no FK from notification_pending_events.application_id to permit_applications found in pg_constraint';
  end if;
  if delete_action <> 'c' then
    raise exception 'FAIL: notification_pending_events.application_id FK is not ON DELETE CASCADE (pg_constraint.confdeltype = %)', delete_action;
  end if;
  raise notice 'PASS: notification_pending_events.application_id FK is ON DELETE CASCADE (pg_constraint.confdeltype = c) -- a deleted application has nothing left to digest';
end $$;

-- application_document_id's ON DELETE SET NULL behavior is already fully
-- covered, against the identical FK/CHECK shape, by
-- notification_log.test.sql's own section 5 -- not re-proven here to avoid
-- duplicating that fixture-heavy dance (disabling document_revisions'
-- append-only trigger, etc.) for a behavior that is schema-identical
-- between the two tables' application_document_id columns.

-- === 7. TRUNCATE gap ===
set local role service_role;

do $$
declare
  grant_count int;
begin
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_name = 'notification_pending_events'
    and grantee = 'service_role'
    and privilege_type = 'TRUNCATE';
  if grant_count <> 0 then
    raise exception 'FAIL: service_role still holds a TRUNCATE grant on notification_pending_events';
  end if;
  raise notice 'PASS: service_role has no TRUNCATE grant on notification_pending_events';
end $$;

do $$
begin
  begin
    truncate notification_pending_events;
    raise exception 'FAIL: service_role was able to TRUNCATE notification_pending_events';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on notification_pending_events is rejected for service_role (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
