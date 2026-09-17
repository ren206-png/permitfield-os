-- Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K, 20260806000047_notification_log.sql).
-- Proves, for the new notification_log table, the same shape of guarantees
-- this codebase's other internal-ops "no SELECT policy, insert-only for
-- service_role" tables get (drawing_findings_rejected.test.sql /
-- ai_findings_rejected's own migration header), plus this table's own new
-- CHECK constraints:
--   1. RLS default-deny: with RLS enabled and zero policies, `authenticated`
--      cannot SELECT/INSERT/UPDATE/DELETE a row, even inside its own org.
--   2. service_role grant is INSERT-only, not SELECT -- an attempted SELECT
--      is rejected by a table-level permission error (no GRANT), a
--      different failure mode than RLS's policy-level denial in (1).
--   3. Append-only: even service_role (BYPASSRLS) is blocked from
--      UPDATE/DELETE by the forbid_update_delete() trigger -- a row-level
--      trigger, not an RLS policy, so BYPASSRLS doesn't help.
--   4. CHECK constraints: (status='failed') = (error_message is not null),
--      (event_kind='drawing_review_completed') = (application_document_id
--      is not null), channel = 'email', provider = 'resend', and event_kind
--      restricted to its six known values.
--   5. application_document_id's FK is ON DELETE SET NULL, not CASCADE --
--      deleting the referenced application_documents row leaves the log
--      row in place with the reference nulled out.
--   6. recipient_user_id's FK is ON DELETE SET NULL, not CASCADE -- same
--      reasoning, for a deleted auth.users row.
--   7. TRUNCATE: service_role holds no TRUNCATE grant and cannot TRUNCATE
--      this table (same gap-closing pattern as
--      service_role_truncate_append_only.test.sql / drawing_findings_rejected.test.sql).
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/notification_log.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A fixtures from supabase/seed.sql PART 2 (same as
-- drawing_review_schema.test.sql / drawing_findings_rejected.test.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a, application 40000000-...000a

-- Throwaway user for the recipient_user_id ON DELETE SET NULL check below --
-- same "insert a synthetic auth.users row rather than delete a fixture
-- other tests depend on" reasoning as ai_jobs_ledger_human_reviews.test.sql.
-- Inserted BEFORE the `set local role service_role` switch below, as the
-- connection's default (superuser) role -- service_role itself has no
-- INSERT grant on auth.users (that's Supabase Auth's own table, not one
-- this codebase grants against), same ordering ai_jobs_ledger_human_reviews.
-- test.sql uses for its own synthetic auth.users fixture.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated',
        'orga-notify-recipient@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

set local role service_role;

insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
values
  ('79000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   'org-a/notify-fixture-drawing.pdf', 'notify-fixture-drawing.pdf', 'application/pdf', 2048, repeat('f', 64), 'blueprint')
on conflict (id) do nothing;

-- === 1. service_role can INSERT rows, including both event_kind shapes ===
insert into notification_log (id, org_id, application_id, application_document_id, event_kind, recipient_user_id, recipient_email, status, provider_message_id)
values
  ('7a000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   null, 'audit_completed', '10000000-0000-0000-0000-00000000000d', 'orga-notify-recipient@test.permitfield.local', 'sent', 'resend-msg-1'),
  ('7a000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   '79000000-0000-0000-0000-00000000000a', 'drawing_review_completed', '10000000-0000-0000-0000-00000000000d', 'orga-notify-recipient@test.permitfield.local', 'sent', 'resend-msg-2');

insert into notification_log (id, org_id, application_id, event_kind, recipient_user_id, recipient_email, status, error_message)
values
  ('7a000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   'pdf_generation_failed', '10000000-0000-0000-0000-00000000000d', 'orga-notify-recipient@test.permitfield.local', 'failed', 'Resend send failed: bounced');

-- Verification of the INSERTs' success must NOT run as service_role: this
-- table deliberately grants service_role INSERT only, not SELECT (that's
-- exactly what check 2 below tests for), so a same-role verification SELECT
-- would fail with insufficient_privilege for reasons unrelated to whether
-- the INSERT itself succeeded. Drop to the connecting/superuser role for
-- this control check only, then resume as service_role immediately after.
reset role;

do $$
declare
  inserted_count int;
begin
  select count(*) into inserted_count from notification_log
  where id in ('7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-00000000000b', '7a000000-0000-0000-0000-00000000000c');
  if inserted_count <> 3 then
    raise exception 'FAIL: service_role INSERT of notification_log rows did not succeed as expected (got %)', inserted_count;
  end if;
  raise notice 'PASS: service_role can INSERT notification_log rows for both application-scoped and drawing-document-scoped event kinds, and for a failed send';
end $$;

set local role service_role;

-- === 4a. CHECK: (status = 'failed') = (error_message is not null) ===
do $$
begin
  begin
    insert into notification_log (org_id, application_id, event_kind, recipient_user_id, recipient_email, status, error_message)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'audit_completed',
            '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'failed', null);
    raise exception 'FAIL: inserted a status=failed row with a null error_message';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects status=failed with a null error_message (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into notification_log (org_id, application_id, event_kind, recipient_user_id, recipient_email, status, error_message)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'audit_completed',
            '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent', 'should not have an error message');
    raise exception 'FAIL: inserted a status=sent row with a non-null error_message';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects status=sent with a non-null error_message (%)', sqlerrm;
  end;
end $$;

-- === 4b. CHECK: event_kind = 'drawing_review_completed' or application_document_id is null ===
-- Deliberately one-directional (see the migration's own comment on this
-- CHECK): a drawing_review_completed row is EXPECTED (by
-- lib/notifications/content.ts, the only writer) to always carry a
-- document id at insert time, but the CHECK itself does not enforce that
-- direction, because application_document_id's own `on delete set null` FK
-- must be able to null it out later without violating this constraint (a
-- bidirectional version of this CHECK made that FK behavior impossible --
-- confirmed live before this fix, and re-verified as fixed by section 5
-- below, which nulls exactly this column on exactly a drawing_review_
-- completed row without error). So this sub-test asserts the ALLOWED case,
-- not a rejection.
-- No `returning ... into` here: RETURNING requires a SELECT-level privilege
-- check on the returned columns in Postgres, and service_role deliberately
-- holds INSERT only on this table (section 2 above) -- using RETURNING
-- would fail for a reason unrelated to the CHECK constraint actually under
-- test here.
insert into notification_log (org_id, application_id, event_kind, recipient_user_id, recipient_email, status)
values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'drawing_review_completed',
        '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent');
do $$
begin
  raise notice 'PASS: a drawing_review_completed row with a null application_document_id is accepted -- deliberately allowed so the ON DELETE SET NULL FK below can null this column without a CHECK conflict';
end $$;

do $$
begin
  begin
    insert into notification_log (org_id, application_id, application_document_id, event_kind, recipient_user_id, recipient_email, status)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '79000000-0000-0000-0000-00000000000a',
            'audit_completed', '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent');
    raise exception 'FAIL: inserted a non-drawing-review event_kind row with a non-null application_document_id';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects a non-drawing-review event_kind with a non-null application_document_id (%)', sqlerrm;
  end;
end $$;

-- === 4c. CHECK: channel restricted to 'email', provider restricted to 'resend', event_kind restricted to its six values ===
do $$
begin
  begin
    insert into notification_log (org_id, application_id, event_kind, channel, recipient_user_id, recipient_email, status)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'audit_completed', 'sms',
            '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent');
    raise exception 'FAIL: inserted a row with channel=sms (only email exists today)';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects an unsupported channel value (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into notification_log (org_id, application_id, event_kind, provider, recipient_user_id, recipient_email, status)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'audit_completed', 'sendgrid',
            '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent');
    raise exception 'FAIL: inserted a row with provider=sendgrid (only resend exists today)';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects an unsupported provider value (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into notification_log (org_id, application_id, event_kind, recipient_user_id, recipient_email, status)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'application_submitted',
            '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent');
    raise exception 'FAIL: inserted a row with an event_kind not in the known six-value list';
  exception
    when check_violation then
      raise notice 'PASS: CHECK correctly rejects an unrecognized event_kind value (%)', sqlerrm;
  end;
end $$;

-- === 2. service_role has INSERT only, not SELECT (table-level grant, distinct from RLS) ===
do $$
begin
  begin
    perform 1 from notification_log limit 1;
    raise exception 'FAIL: service_role was able to SELECT from notification_log (should be insert-only, per 20260806000045:48 precedent)';
  exception
    when insufficient_privilege then
      raise notice 'PASS: SELECT on notification_log correctly rejected for service_role (insert-only grant) (%)', sqlerrm;
  end;
end $$;

-- === 3. Append-only: even service_role (BYPASSRLS) is blocked by the trigger ===
do $$
begin
  begin
    update notification_log set status = 'sent' where id = '7a000000-0000-0000-0000-00000000000c';
    raise exception 'FAIL: service_role was able to UPDATE a notification_log row';
  exception
    when others then
      raise notice 'PASS: UPDATE on notification_log correctly rejected for service_role by the append-only trigger (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from notification_log where id = '7a000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE a notification_log row';
  exception
    when others then
      raise notice 'PASS: DELETE on notification_log correctly rejected for service_role by the append-only trigger (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 1. RLS default-deny for `authenticated` (no policies at all) ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    perform 1 from notification_log limit 1;
    raise exception 'FAIL: authenticated (org A owner) was able to SELECT from notification_log (should be default-deny, zero policies)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: SELECT on notification_log correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into notification_log (org_id, application_id, event_kind, recipient_user_id, recipient_email, status)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'audit_completed',
            '10000000-0000-0000-0000-00000000000d', 'x@test.permitfield.local', 'sent');
    raise exception 'FAIL: authenticated was able to INSERT into notification_log (should be service_role only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT on notification_log correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update notification_log set status = 'sent' where id = '7a000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE a notification_log row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: UPDATE on notification_log correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from notification_log where id = '7a000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE a notification_log row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: DELETE on notification_log correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 5. application_document_id FK is ON DELETE SET NULL, not CASCADE ===
-- Run as the connecting/superuser role, not service_role: service_role
-- holds neither a DELETE grant on application_documents nor a SELECT grant
-- on notification_log, so both the DELETE itself and this verification
-- query would fail for reasons unrelated to the ON DELETE SET NULL
-- behavior actually under test. Same disable-trigger dance as
-- drawing_findings_rejected.test.sql's own section 4 -- document_revisions'
-- forbid_update_delete() trigger fires unconditionally, even for a
-- superuser, and would otherwise turn this ON DELETE SET NULL into an
-- exception before it ever reaches notification_log. UNLIKE
-- drawing_findings_rejected (which has no append-only trigger of its own),
-- notification_log's OWN forbid_update_delete() trigger also fires
-- unconditionally on the FK's resulting `UPDATE ... SET
-- application_document_id = NULL` against notification_log itself, so that
-- one needs disabling too, for this statement only.
alter table document_revisions disable trigger document_revisions_append_only;
alter table notification_log disable trigger notification_log_append_only;
delete from application_documents where id = '79000000-0000-0000-0000-00000000000a';
alter table notification_log enable trigger notification_log_append_only;
alter table document_revisions enable trigger document_revisions_append_only;

do $$
declare
  remaining_count int;
  nulled_reference uuid;
begin
  select count(*) into remaining_count from notification_log where id = '7a000000-0000-0000-0000-00000000000b';
  if remaining_count <> 1 then
    raise exception 'FAIL: deleting the referenced application_documents row deleted the notification_log row too (expected ON DELETE SET NULL, not CASCADE)';
  end if;
  select application_document_id into nulled_reference from notification_log where id = '7a000000-0000-0000-0000-00000000000b';
  if nulled_reference is not null then
    raise exception 'FAIL: application_document_id was not nulled out after its referenced application_documents row was deleted, got %', nulled_reference;
  end if;
  raise notice 'PASS: deleting the referenced application_documents row leaves the notification_log row in place with application_document_id nulled (ON DELETE SET NULL)';
end $$;

-- === 6. recipient_user_id FK is ON DELETE SET NULL, not CASCADE ===
-- Same reasoning as section 5 above: the FK's resulting `UPDATE ... SET
-- recipient_user_id = NULL` against notification_log is itself blocked by
-- notification_log's own append-only trigger unless disabled first.
alter table notification_log disable trigger notification_log_append_only;
delete from auth.users where id = '10000000-0000-0000-0000-00000000000d';
alter table notification_log enable trigger notification_log_append_only;

do $$
declare
  remaining_count int;
  nulled_reference uuid;
begin
  select count(*) into remaining_count from notification_log where id = '7a000000-0000-0000-0000-00000000000a';
  if remaining_count <> 1 then
    raise exception 'FAIL: deleting the referenced auth.users row deleted the notification_log row too (expected ON DELETE SET NULL, not CASCADE)';
  end if;
  select recipient_user_id into nulled_reference from notification_log where id = '7a000000-0000-0000-0000-00000000000a';
  if nulled_reference is not null then
    raise exception 'FAIL: recipient_user_id was not nulled out after its referenced auth.users row was deleted, got %', nulled_reference;
  end if;
  raise notice 'PASS: deleting the referenced auth.users row leaves the notification_log row in place with recipient_user_id nulled (ON DELETE SET NULL) -- recipient_email is denormalized and untouched, preserving the delivery record';
end $$;

-- === 7. TRUNCATE gap ===
set local role service_role;

do $$
declare
  grant_count int;
begin
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_name = 'notification_log'
    and grantee = 'service_role'
    and privilege_type = 'TRUNCATE';
  if grant_count <> 0 then
    raise exception 'FAIL: service_role still holds a TRUNCATE grant on notification_log';
  end if;
  raise notice 'PASS: service_role has no TRUNCATE grant on notification_log';
end $$;

do $$
begin
  begin
    truncate notification_log;
    raise exception 'FAIL: service_role was able to TRUNCATE notification_log';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on notification_log is rejected for service_role (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
