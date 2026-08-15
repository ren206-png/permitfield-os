-- Gate 2.0 sub-phase 2.3 (20260806000031_application_documents_service_role_insert.sql,
-- GATE_2_0_SPEC.md §5/§6, reviewed in GATE_2_0_FINDINGS.md §J). Proves the
-- new `grant insert on application_documents to service_role;` actually
-- both closes the gap (service_role could not INSERT before it) and does
-- so without touching service_role's pre-existing select/update
-- capability on this same table.
--
-- Control-then-assert, inverted from this repo's usual shape because this
-- is a new capability being added, not a restriction -- exactly as
-- GATE_2_0_SPEC.md §6's sub-phase-2.3 row specifies: (a) control -- with
-- the grant rolled back (explicit REVOKE, not merely assumed absent),
-- confirm the INSERT actually fails with permission denied, proving the
-- gap was real and reachable, not assumed. (b) assert -- with the grant
-- restored, the identical INSERT succeeds. (c) regression -- confirm
-- service_role's pre-existing select/update capability on this table is
-- unchanged, using the exact column shapes lib/inngest/functions/
-- {extract,audit}.ts actually read/write (GATE_2_0_FINDINGS.md §J.4),
-- not an arbitrary column list.
--
-- Runs as the connecting role for this session (postgres, the local
-- superuser and the table owner) to perform the REVOKE/GRANT DDL, then
-- SET ROLE service_role for each INSERT/SELECT/UPDATE attempt -- same
-- "only the owning role can alter privileges here" reasoning as
-- audit_logs_external_actor.test.sql, applied to GRANT/REVOKE instead of
-- ALTER TABLE ... CONSTRAINT. service_role itself is never granted DDL on
-- this table either way.
--
-- Reuses supabase/seed.sql PART 2's Org A permit_applications fixture
-- (application id 40000000-0000-0000-0000-00000000000a) -- application_id
-- is FK-enforced (permit_applications(id)), so this file cannot invent an
-- arbitrary id for it. application_documents itself has zero seed.sql
-- fixture rows (confirmed by 20260806000024's own header comment), so
-- every row this file touches is inserted here.
--
-- Whole file wrapped in begin/rollback: GRANT/REVOKE and SET ROLE are both
-- transactional/session-scoped and fully undone by ROLLBACK, and (unlike
-- audit_logs/document_revisions/client_access_log/token_lifecycle_events)
-- application_documents carries no forbid_update_delete() trigger, so no
-- savepoint/rollback-to-savepoint trick is needed mid-transaction to clean
-- up control rows -- the final ROLLBACK alone is sufficient.

begin;

-- Step 1: explicitly revoke the grant this migration adds, so the control
-- step below starts from an unambiguous "gap is present" state rather than
-- assuming it -- matches this file's own migration statement exactly, run
-- in reverse.
revoke insert on application_documents from service_role;

-- Step 2 (control): as service_role, with the grant absent, the INSERT
-- fails with permission denied -- proving the gap §J.1 re-confirmed was
-- real and reachable, not merely asserted from reading a grants file.
set role service_role;

do $$
begin
  insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256)
  values ('53000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
          'org-a/40000000-0000-0000-0000-00000000000a/control.pdf', 'control.pdf', 'application/pdf', 1024,
          repeat('a1', 32));
  raise exception 'FAIL (control): service_role INSERT succeeded into application_documents without the insert grant -- the later success assertion would prove nothing without this control';
exception
  when insufficient_privilege then
    raise notice 'PASS (control): service_role INSERT correctly rejected (permission denied) before the grant is applied. (%)', sqlerrm;
end $$;

reset role;

-- Step 3: restore the grant exactly as the migration defines it.
grant insert on application_documents to service_role;

-- Step 4 (assert): the identical INSERT now succeeds.
set role service_role;

do $$
declare
  v_count int;
begin
  insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256)
  values ('53000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
          'org-a/40000000-0000-0000-0000-00000000000a/control.pdf', 'control.pdf', 'application/pdf', 1024,
          repeat('a1', 32));

  select count(*) into v_count from application_documents where id = '53000000-0000-0000-0000-00000000000a';
  if v_count <> 1 then
    raise exception 'FAIL (assert): service_role INSERT did not persist after the grant was restored (count=%)', v_count;
  end if;
  raise notice 'PASS (assert): service_role INSERT succeeds once the grant is restored (count=%).', v_count;
end $$;

-- Step 5 (regression, SELECT): the exact column shape
-- lib/inngest/functions/extract.ts reads
-- (`.select('id, storage_path, original_filename, mime_type')`, L47-48)
-- still succeeds for service_role, unchanged by this migration.
do $$
declare
  v_row record;
begin
  select id, storage_path, original_filename, mime_type
  into v_row
  from application_documents
  where id = '53000000-0000-0000-0000-00000000000a';

  if v_row.id is null then
    raise exception 'FAIL (regression): service_role SELECT of extract.ts''s expected column shape returned no row';
  end if;
  raise notice 'PASS (regression): service_role SELECT (id, storage_path, original_filename, mime_type) still succeeds unchanged (id=%).', v_row.id;
end $$;

-- Step 5b (regression, SELECT): the exact column
-- lib/inngest/functions/audit.ts reads (`.select('doc_kind')`, L88-89)
-- also still succeeds.
do $$
declare
  v_doc_kind doc_kind;
begin
  select doc_kind into v_doc_kind
  from application_documents
  where id = '53000000-0000-0000-0000-00000000000a';

  raise notice 'PASS (regression): service_role SELECT (doc_kind) still succeeds unchanged (doc_kind=%).', v_doc_kind;
end $$;

-- Step 6 (regression, UPDATE): the exact write
-- lib/inngest/functions/extract.ts performs
-- (`.update({ text_layer_chars: ... })`, L101-103) still succeeds for
-- service_role, unchanged by this migration.
do $$
declare
  v_text_layer_chars int;
begin
  update application_documents
  set text_layer_chars = 4200
  where id = '53000000-0000-0000-0000-00000000000a';

  select text_layer_chars into v_text_layer_chars
  from application_documents
  where id = '53000000-0000-0000-0000-00000000000a';

  if v_text_layer_chars is distinct from 4200 then
    raise exception 'FAIL (regression): service_role UPDATE of text_layer_chars did not persist (got %)', v_text_layer_chars;
  end if;
  raise notice 'PASS (regression): service_role UPDATE (text_layer_chars) still succeeds unchanged (text_layer_chars=%).', v_text_layer_chars;
end $$;

reset role;

rollback;
