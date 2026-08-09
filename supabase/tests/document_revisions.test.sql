-- Lifecycle & Compliance Expansion, Gate 1.4. Proves, against the actual
-- `authenticated`/`service_role` Postgres roles under RLS (not just "the UI
-- doesn't show a button for it" -- same discipline as every other file in
-- this directory), everything 20260806000024_lifecycle_documents_revisions.sql
-- adds:
--   1. A fresh application_documents INSERT (via the existing, unchanged
--      application_documents_insert RLS policy) auto-seeds a
--      document_revisions revision_number=1 row via seed_document_revision().
--   2. Mandatory IDOR test (SS3.6): a cross-org fetch of another org's
--      document, or its revision history, returns zero rows under RLS (the
--      DB-layer equivalent of the app layer's "404, not 403" contract) --
--      for both application_documents and document_revisions. anon sees
--      nothing either.
--   3. replace_application_document(): happy path (new revision recorded,
--      current-revision columns denormalized onto the parent, a prior
--      review verdict is cleared); cross-org caller rejected
--      (insufficient_privilege); a role with no 'create' grant on
--      application_documents (auditor_readonly) rejected; a magic-byte
--      mismatch rejected (invalid_file_signature, 22023); an oversized
--      byte_size rejected (file_too_large, 22023), isolated from the
--      magic-byte check by using a valid header.
--   4. archive_application_document(): a role with 'update' but not
--      'archive' (permit_coordinator) rejected; cross-org caller rejected;
--      a role with 'archive' (document_reviewer) succeeds; a retried
--      archival on an already-archived document is a silent, idempotent
--      no-op (same archived_at, not a new archival event).
--   5. An archived document cannot receive a new revision
--      (document_archived).
--   6. THE USER-MANDATED HARD CONSTRAINT: unique(application_document_id,
--      revision_number) on document_revisions rejects a duplicate
--      revision_number with a real unique_violation (23505) at the DB
--      layer, independent of replace_application_document()'s own
--      row-locking logic -- probed as the file's base (superuser) role,
--      since document_revisions has no INSERT grant for `authenticated` or
--      `service_role` at all (see item 8).
--   7. document_revisions is append-only -- forbid_update_delete() rejects
--      UPDATE/DELETE even for service_role (defeats BYPASSRLS, same as
--      application_status_history).
--   8. document_revisions has NO INSERT/UPDATE/DELETE grant for
--      `authenticated` at all -- a direct INSERT from an ordinary session,
--      even for a legitimate same-org row, is rejected at the grant layer
--      before RLS is ever relevant.
--   9. Hard DELETE on application_documents is gone -- a direct DELETE from
--      an org owner (who COULD do this before Gate 1.4) now fails with
--      insufficient_privilege, before RLS is evaluated.
--  10. validate_document_magic_bytes() spot-checks all four allowed MIME
--      types (PDF/JPEG/PNG/TIFF) plus rejection of an unrecognized MIME
--      type and a too-short header.
--
-- HOW TO RUN:
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/document_revisions.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh). Also runs automatically on every push/PR
-- via .github/workflows/ci.yml's sql-tests job.

begin;

-- Reuses Org A/B owner fixtures from supabase/seed.sql PART 2:
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b
-- Reuses Org A/B's fixture permit_applications rows:
--   40000000-0000-0000-0000-00000000000a (Org A), ...b (Org B)

-- Dedicated document_reviewer/permit_coordinator/auditor_readonly fixture
-- users for Org A, added here the same way permit_status_machine.test.sql
-- adds its own role fixtures -- Org A's seed owner alone can't exercise the
-- role-gating this migration's two RPCs do.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000020', 'authenticated', 'authenticated',
   'document-reviewer@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000021', 'authenticated', 'authenticated',
   'permit-coordinator-docs@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000022', 'authenticated', 'authenticated',
   'auditor-readonly-docs@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000020', 'document_reviewer'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000021', 'permit_coordinator'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000022', 'auditor_readonly')
on conflict (org_id, user_id) do nothing;

-- Fixed document ids so later sections can reference them without threading
-- a variable across separate `do $$ ... $$` blocks (each block is its own
-- PL/pgSQL scope).
--   DOC_A = 70000000-0000-0000-0000-00000000000a (Org A's fixture document)
--   DOC_B = 70000000-0000-0000-0000-00000000000b (Org B's fixture document)

-- === 1. Fresh upload auto-seeds a revision_number=1 document_revisions row ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  rev_count int;
  rev_number int;
begin
  insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
  values ('70000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
          'orgA/fixture-v1.pdf', 'fixture-v1.pdf', 'application/pdf', 1000, repeat('a', 64), 'other');

  select count(*), min(revision_number) into rev_count, rev_number
  from document_revisions where application_document_id = '70000000-0000-0000-0000-00000000000a';

  if rev_count <> 1 or rev_number <> 1 then
    raise exception 'FAIL: expected exactly 1 seeded revision (number 1), got % row(s) starting at %', rev_count, rev_number;
  end if;
  raise notice 'PASS: fresh application_documents INSERT auto-seeds a revision_number=1 document_revisions row';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
begin
  insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
  values ('70000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b',
          'orgB/fixture-v1.pdf', 'fixture-v1.pdf', 'application/pdf', 1000, repeat('e', 64), 'other');
  raise notice 'PASS: Org B fixture document (DOC_B) created';
end $$;

-- === 2. Mandatory IDOR test (SS3.6): cross-org fetch returns zero rows ===
-- Org B owner attempts to read Org A's document and its revision history.
do $$
declare
  doc_count int;
  rev_count int;
begin
  select count(*) into doc_count from application_documents where id = '70000000-0000-0000-0000-00000000000a';
  if doc_count <> 0 then
    raise exception 'FAIL: Org B could see Org A''s application_documents row (IDOR)';
  end if;

  select count(*) into rev_count from document_revisions where application_document_id = '70000000-0000-0000-0000-00000000000a';
  if rev_count <> 0 then
    raise exception 'FAIL: Org B could see Org A''s document_revisions rows (IDOR)';
  end if;

  raise notice 'PASS: cross-org fetch of Org A''s document and its revision history returns zero rows (IDOR-safe)';
end $$;

-- anon sees nothing at all, same shape as tenant_isolation.test.sql.
set local request.jwt.claims = '';
set local role anon;

do $$
declare
  doc_count int;
  rev_count int;
begin
  select count(*) into doc_count from application_documents;
  if doc_count <> 0 then
    raise exception 'FAIL: anon role could see % application_documents rows', doc_count;
  end if;

  select count(*) into rev_count from document_revisions;
  if rev_count <> 0 then
    raise exception 'FAIL: anon role could see % document_revisions rows', rev_count;
  end if;

  raise notice 'PASS: anon role sees zero application_documents/document_revisions rows';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- === 3. replace_application_document() ===

-- 3a. Setup: directly (as if reviewed once already) mark DOC_A 'approved' via
-- the service_role's pre-existing table-level UPDATE grant (20260806000015)
-- -- there is no RPC for this (SS N, PHASE_0_FINDINGS.md), so this is a raw
-- test-fixture write, not a claim that any real code path does this today.
-- Its only purpose is to prove replace_application_document() clears a
-- stale review verdict when a new revision supersedes it.
set local role service_role;

do $$
begin
  update application_documents
  set status = 'approved', reviewed_by = '10000000-0000-0000-0000-00000000000a', reviewed_at = now()
  where id = '70000000-0000-0000-0000-00000000000a';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- 3b. Happy path: Org A owner replaces DOC_A with a new revision.
do $$
declare
  result application_documents;
  rev_count int;
  max_rev int;
begin
  select * into result from replace_application_document(
    '70000000-0000-0000-0000-00000000000a',
    'orgA/fixture-v2.pdf', 'fixture-v2.pdf', 'application/pdf', 2000, repeat('b', 64),
    '\x255044462d312e34'::bytea -- "%PDF-1.4"
  );

  if result.storage_path <> 'orgA/fixture-v2.pdf' or result.sha256 <> repeat('b', 64) or result.byte_size <> 2000 then
    raise exception 'FAIL: replace_application_document() did not denormalize the new revision onto application_documents (got path=%, sha256=%, size=%)', result.storage_path, result.sha256, result.byte_size;
  end if;

  if result.status <> 'pending' or result.reviewed_by is not null or result.reviewed_at is not null then
    raise exception 'FAIL: replace_application_document() did not clear the prior review verdict (status=%, reviewed_by=%, reviewed_at=%)', result.status, result.reviewed_by, result.reviewed_at;
  end if;

  select count(*), max(revision_number) into rev_count, max_rev
  from document_revisions where application_document_id = '70000000-0000-0000-0000-00000000000a';
  if rev_count <> 2 or max_rev <> 2 then
    raise exception 'FAIL: expected 2 document_revisions rows (revisions 1 and 2), got % rows, max revision_number %', rev_count, max_rev;
  end if;

  raise notice 'PASS: replace_application_document() records revision 2, denormalizes current state, and clears the prior review verdict';
end $$;

-- 3c. Cross-org caller rejected.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
begin
  begin
    perform replace_application_document(
      '70000000-0000-0000-0000-00000000000a',
      'orgB/hijack.pdf', 'hijack.pdf', 'application/pdf', 1000, repeat('c', 64),
      '\x255044462d312e34'::bytea
    );
    raise exception 'FAIL: Org B owner was able to replace Org A''s document';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: cross-org replace_application_document() call correctly rejected (%)', sqlerrm;
  end;
end $$;

-- 3d. Role with no 'create' grant on application_documents (auditor_readonly)
-- rejected, even though it IS a member of the org.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000022","role":"authenticated"}';

do $$
begin
  begin
    perform replace_application_document(
      '70000000-0000-0000-0000-00000000000a',
      'orgA/auditor-attempt.pdf', 'auditor-attempt.pdf', 'application/pdf', 1000, repeat('d', 64),
      '\x255044462d312e34'::bytea
    );
    raise exception 'FAIL: auditor_readonly was able to call replace_application_document()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: auditor_readonly (no ''create'' grant on application_documents) correctly rejected (%)', sqlerrm;
  end;
end $$;

-- 3e. Magic-byte mismatch rejected -- declared application/pdf, actual bytes
-- are a JPEG signature.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    perform replace_application_document(
      '70000000-0000-0000-0000-00000000000a',
      'orgA/fake.pdf', 'fake.pdf', 'application/pdf', 1000, repeat('f', 64),
      '\xffd8ffe000104a464946'::bytea -- real JPEG header, declared as a PDF
    );
    raise exception 'FAIL: replace_application_document() accepted a JPEG-signature file declared as application/pdf';
  exception
    when sqlstate '22023' then
      if sqlerrm not like 'invalid_file_signature%' then
        raise exception 'FAIL: expected invalid_file_signature, got a different 22023 error: %', sqlerrm;
      end if;
      raise notice 'PASS: magic-byte mismatch correctly rejected (%)', sqlerrm;
  end;
end $$;

-- 3f. Oversized byte_size rejected -- isolated from the magic-byte check by
-- using a genuinely valid PDF header, so this specifically exercises the
-- size check, not a repeat of 3e.
do $$
begin
  begin
    perform replace_application_document(
      '70000000-0000-0000-0000-00000000000a',
      'orgA/huge.pdf', 'huge.pdf', 'application/pdf', 30000000, repeat('g', 64),
      '\x255044462d312e34'::bytea
    );
    raise exception 'FAIL: replace_application_document() accepted a 30MB file (25MB/file cap)';
  exception
    when sqlstate '22023' then
      if sqlerrm not like 'file_too_large%' then
        raise exception 'FAIL: expected file_too_large, got a different 22023 error: %', sqlerrm;
      end if;
      raise notice 'PASS: oversized byte_size correctly rejected (%)', sqlerrm;
  end;
end $$;

-- === 4. archive_application_document() ===

-- 4a. Role with 'update' but not 'archive' on application_documents
-- (permit_coordinator) rejected.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000021","role":"authenticated"}';

do $$
begin
  begin
    perform archive_application_document('70000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: permit_coordinator (has update, not archive, on application_documents) was able to archive a document';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: permit_coordinator correctly rejected from archive_application_document() (%)', sqlerrm;
  end;
end $$;

-- 4b. Cross-org caller rejected.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
begin
  begin
    perform archive_application_document('70000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: Org B owner was able to archive Org A''s document';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: cross-org archive_application_document() call correctly rejected (%)', sqlerrm;
  end;
end $$;

-- 4c. document_reviewer (has 'archive') succeeds.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000020","role":"authenticated"}';

do $$
declare
  result application_documents;
begin
  select * into result from archive_application_document('70000000-0000-0000-0000-00000000000a');
  if result.archived_at is null or result.archived_by <> '10000000-0000-0000-0000-000000000020' then
    raise exception 'FAIL: archive_application_document() did not set archived_at/archived_by (archived_at=%, archived_by=%)', result.archived_at, result.archived_by;
  end if;
  raise notice 'PASS: document_reviewer successfully archived DOC_A (archived_at=%)', result.archived_at;
end $$;

-- 4d. Idempotent retry: archiving an already-archived document is a silent
-- no-op -- same archived_at, not a new archival event.
do $$
declare
  first_archived_at timestamptz;
  second_archived_at timestamptz;
  result application_documents;
begin
  select archived_at into first_archived_at from application_documents where id = '70000000-0000-0000-0000-00000000000a';

  perform pg_sleep(0.01); -- guarantee now() would differ if this were NOT a no-op
  select * into result from archive_application_document('70000000-0000-0000-0000-00000000000a');
  second_archived_at := result.archived_at;

  if second_archived_at <> first_archived_at then
    raise exception 'FAIL: re-archiving an already-archived document changed archived_at from % to % (should be a silent no-op)', first_archived_at, second_archived_at;
  end if;
  raise notice 'PASS: retried archive_application_document() call is an idempotent no-op (archived_at unchanged: %)', second_archived_at;
end $$;

-- === 5. An archived document cannot receive a new revision ===
do $$
begin
  begin
    perform replace_application_document(
      '70000000-0000-0000-0000-00000000000a',
      'orgA/post-archive.pdf', 'post-archive.pdf', 'application/pdf', 1000, repeat('h', 64),
      '\x255044462d312e34'::bytea
    );
    raise exception 'FAIL: replace_application_document() accepted a new revision for an archived document';
  exception
    when others then
      if sqlerrm not like 'document_archived%' then
        raise exception 'FAIL: expected document_archived, got a different error: % (%)', sqlerrm, sqlstate;
      end if;
      raise notice 'PASS: archived document correctly refuses a new revision (%)', sqlerrm;
  end;
end $$;

-- === 6. THE USER-MANDATED HARD CONSTRAINT: unique(application_document_id,
-- revision_number) rejects a duplicate at the DB layer, independent of
-- replace_application_document()'s own row-locking. document_revisions has
-- no INSERT grant for `authenticated` or `service_role` (item 8 below), so
-- this is probed as the file's base connecting role (typically a superuser
-- in local `psql -f ...` runs, per this file's own HOW TO RUN), which
-- bypasses RLS/grants and reaches the constraint directly. DOC_B already
-- has a revision_number=1 row from its own fixture-insert-triggered seed
-- (section 1) -- attempt to insert a second one with the same number.
reset role;
reset request.jwt.claims;

do $$
begin
  begin
    insert into document_revisions (application_document_id, revision_number, storage_path, original_filename, mime_type, byte_size, sha256)
    values ('70000000-0000-0000-0000-00000000000b', 1, 'orgB/dup.pdf', 'dup.pdf', 'application/pdf', 1000, repeat('i', 64));
    raise exception 'FAIL: a duplicate (application_document_id, revision_number) was accepted by document_revisions';
  exception
    when unique_violation then
      raise notice 'PASS: unique(application_document_id, revision_number) rejects a duplicate revision_number with unique_violation (%)', sqlerrm;
  end;
end $$;

-- === 7. document_revisions is append-only, even for service_role ===
set local role service_role;

do $$
begin
  begin
    update document_revisions set storage_path = 'tampered' where application_document_id = '70000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE a document_revisions row';
  exception
    when others then
      raise notice 'PASS: document_revisions UPDATE correctly rejected even for service_role (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from document_revisions where application_document_id = '70000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE a document_revisions row';
  exception
    when others then
      raise notice 'PASS: document_revisions DELETE correctly rejected even for service_role (%)', sqlerrm;
  end;
end $$;

-- === 8. No direct INSERT path into document_revisions for `authenticated` ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    insert into document_revisions (application_document_id, revision_number, storage_path, original_filename, mime_type, byte_size, sha256)
    values ('70000000-0000-0000-0000-00000000000a', 99, 'orgA/direct-insert.pdf', 'direct-insert.pdf', 'application/pdf', 1000, repeat('j', 64));
    raise exception 'FAIL: an ordinary authenticated session was able to INSERT directly into document_revisions';
  exception
    when insufficient_privilege then
      raise notice 'PASS: direct INSERT into document_revisions correctly rejected -- no GRANT at all (%)', sqlerrm;
  end;
end $$;

-- === 9. Hard DELETE on application_documents is gone ===
-- Org A's own owner -- who COULD delete any org document before Gate 1.4
-- (docs/PERMISSIONS.md's now-closed gap) -- is rejected outright.
do $$
begin
  begin
    delete from application_documents where id = '70000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: Org A owner was able to directly DELETE an application_documents row';
  exception
    when insufficient_privilege then
      raise notice 'PASS: direct DELETE on application_documents correctly rejected for every role, including the owning org''s own owner (%)', sqlerrm;
  end;
end $$;

-- === 10. validate_document_magic_bytes() spot checks ===
do $$
begin
  if not validate_document_magic_bytes('application/pdf', '\x255044462d312e34'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() rejected a genuine PDF header';
  end if;
  if not validate_document_magic_bytes('image/jpeg', '\xffd8ffe000104a464946'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() rejected a genuine JPEG header';
  end if;
  if not validate_document_magic_bytes('image/png', '\x89504e470d0a1a0a0000'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() rejected a genuine PNG header';
  end if;
  if not validate_document_magic_bytes('image/tiff', '\x49492a0008000000'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() rejected a genuine little-endian TIFF header';
  end if;
  if not validate_document_magic_bytes('image/tiff', '\x4d4d002a00080000'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() rejected a genuine big-endian TIFF header';
  end if;
  if validate_document_magic_bytes('application/pdf', '\xffd8ffe000104a464946'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() accepted a JPEG header declared as application/pdf';
  end if;
  if validate_document_magic_bytes('application/msword', '\x255044462d312e34'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() accepted an unrecognized MIME type (application/msword)';
  end if;
  if validate_document_magic_bytes('application/pdf', '\x2550'::bytea) then
    raise exception 'FAIL: validate_document_magic_bytes() accepted a header shorter than the PDF signature';
  end if;
  raise notice 'PASS: validate_document_magic_bytes() correctly accepts all four allowed MIME types and rejects mismatches/unknown types/short headers';
end $$;

rollback;
