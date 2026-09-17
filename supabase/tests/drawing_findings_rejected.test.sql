-- Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K,
-- 20260806000045_drawing_findings_rejected.sql). Proves, for the new
-- drawing_findings_rejected table, the same shape of guarantees this
-- codebase's other internal-ops "no SELECT policy, insert-only for
-- service_role" tables get -- no dedicated test file for its sibling
-- ai_findings_rejected (20260806000010) exists yet to mirror line-for-line,
-- so this is written from that migration's own header comment plus the
-- general RLS/grant control-then-assert conventions every other file in
-- this directory already follows:
--   1. RLS default-deny: with RLS enabled and zero policies, `authenticated`
--      cannot SELECT/INSERT/UPDATE/DELETE a row, even inside its own org.
--   2. service_role grant is INSERT-only, not SELECT -- an attempted
--      SELECT is rejected by a table-level permission error (no GRANT), a
--      different failure mode than RLS's policy-level denial in (1).
--   3. drawing_review_id is NOT a foreign key (deliberate, per the
--      migration's header: a rejected finding can come from an attempt
--      whose drawing_reviews row was never inserted at all) -- an arbitrary
--      uuid that matches no real drawing_reviews row is accepted, not
--      rejected.
--   4. application_document_id's FK is ON DELETE SET NULL, not CASCADE --
--      deleting the referenced application_documents row leaves the
--      rejection record in place with the reference nulled out, rather than
--      deleting the rejection record itself.
--   5. TRUNCATE: service_role holds no TRUNCATE grant and cannot TRUNCATE
--      this table (same gap-closing pattern as
--      service_role_truncate_append_only.test.sql /
--      ai_jobs_ledger_human_reviews.test.sql's own TRUNCATE section).
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/drawing_findings_rejected.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A fixtures from supabase/seed.sql PART 2 (same as
-- drawing_review_schema.test.sql / ai_jobs_ledger_human_reviews.test.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a, application 40000000-...000a
set local role service_role;

insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
values
  ('77000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   'org-a/rejected-fixture-drawing.pdf', 'rejected-fixture-drawing.pdf', 'application/pdf', 2048, repeat('e', 64), 'blueprint')
on conflict (id) do nothing;

-- === 1 & 3. service_role can INSERT a row citing a drawing_review_id that
-- matches no real drawing_reviews row at all (no FK, deliberate) ===
insert into drawing_findings_rejected (id, drawing_review_id, application_document_id, raw_finding, rejection_reason, model_id, prompt_version)
values
  ('78000000-0000-0000-0000-00000000000a', '79999999-9999-4999-8999-999999999999',
   '77000000-0000-0000-0000-00000000000a', '{"kind":"code_conflict"}'::jsonb,
   'code_chunk_id does not match any code excerpt that was shown.', 'test-model', 'drawing-review-v1');

-- Verification of the INSERT's success must NOT run as service_role: this
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
  select count(*) into inserted_count from drawing_findings_rejected where id = '78000000-0000-0000-0000-00000000000a';
  if inserted_count <> 1 then
    raise exception 'FAIL: service_role INSERT of a drawing_findings_rejected row (with a drawing_review_id matching no real drawing_reviews row) did not succeed';
  end if;
  raise notice 'PASS: service_role can INSERT a drawing_findings_rejected row whose drawing_review_id matches no drawing_reviews row (drawing_review_id is deliberately not a foreign key)';
end $$;

set local role service_role;

-- === 2. service_role has INSERT only, not SELECT (table-level grant, distinct from RLS) ===
do $$
begin
  begin
    perform 1 from drawing_findings_rejected limit 1;
    raise exception 'FAIL: service_role was able to SELECT from drawing_findings_rejected (should be insert-only, per 20260806000015:48 precedent)';
  exception
    when insufficient_privilege then
      raise notice 'PASS: SELECT on drawing_findings_rejected correctly rejected for service_role (insert-only grant) (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 1. RLS default-deny for `authenticated` (no policies at all) ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    perform 1 from drawing_findings_rejected limit 1;
    raise exception 'FAIL: authenticated (org A owner) was able to SELECT from drawing_findings_rejected (should be default-deny, zero policies)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: SELECT on drawing_findings_rejected correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into drawing_findings_rejected (drawing_review_id, application_document_id, raw_finding, rejection_reason, model_id, prompt_version)
    values ('79999999-9999-4999-8999-999999999998', '77000000-0000-0000-0000-00000000000a', '{}'::jsonb, 'x', 'test-model', 'drawing-review-v1');
    raise exception 'FAIL: authenticated was able to INSERT into drawing_findings_rejected (should be service_role only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT on drawing_findings_rejected correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update drawing_findings_rejected set rejection_reason = 'HACKED' where id = '78000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE a drawing_findings_rejected row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: UPDATE on drawing_findings_rejected correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from drawing_findings_rejected where id = '78000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE a drawing_findings_rejected row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: DELETE on drawing_findings_rejected correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 4. application_document_id FK is ON DELETE SET NULL, not CASCADE ===
-- Run as the connecting/superuser role, not service_role: service_role holds
-- neither a DELETE grant on application_documents (only select/insert/update,
-- per 20260806000015 + 20260806000031) nor a SELECT grant on
-- drawing_findings_rejected (checked in section 2 above), so both the DELETE
-- itself and this verification query would fail for reasons unrelated to
-- the ON DELETE SET NULL behavior actually under test.
--
-- Deleting an application_documents row via any grantable role is actually
-- impossible in this schema by design -- documents are archived, never
-- hard-deleted (20260806000024's header comment; confirmed live by
-- document_revisions.test.sql's own "Hard DELETE on application_documents
-- is gone" check). Every application_documents row also gets a
-- document_revisions child automatically seeded on INSERT
-- (seed_document_revision()), and that child's own forbid_update_delete()
-- append-only trigger fires unconditionally -- even for a superuser --
-- which would otherwise turn this row's ON DELETE CASCADE into an
-- exception before reaching drawing_findings_rejected at all. Disabling
-- that one trigger for this statement (superuser-only DDL, not available
-- to any application role) is the only way to exercise this migration's
-- ON DELETE SET NULL constraint end-to-end; RLS and grants -- what every
-- non-superuser role is actually bound by -- are untouched by this.
alter table document_revisions disable trigger document_revisions_append_only;
delete from application_documents where id = '77000000-0000-0000-0000-00000000000a';
alter table document_revisions enable trigger document_revisions_append_only;

do $$
declare
  remaining_count int;
  nulled_reference uuid;
begin
  select count(*) into remaining_count from drawing_findings_rejected where id = '78000000-0000-0000-0000-00000000000a';
  if remaining_count <> 1 then
    raise exception 'FAIL: deleting the referenced application_documents row deleted the drawing_findings_rejected row too (expected ON DELETE SET NULL, not CASCADE)';
  end if;
  select application_document_id into nulled_reference from drawing_findings_rejected where id = '78000000-0000-0000-0000-00000000000a';
  if nulled_reference is not null then
    raise exception 'FAIL: application_document_id was not nulled out after its referenced application_documents row was deleted, got %', nulled_reference;
  end if;
  raise notice 'PASS: deleting the referenced application_documents row leaves the drawing_findings_rejected row in place with application_document_id nulled (ON DELETE SET NULL)';
end $$;

-- === 5. TRUNCATE gap ===
set local role service_role;

do $$
declare
  grant_count int;
begin
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_name = 'drawing_findings_rejected'
    and grantee = 'service_role'
    and privilege_type = 'TRUNCATE';
  if grant_count <> 0 then
    raise exception 'FAIL: service_role still holds a TRUNCATE grant on drawing_findings_rejected';
  end if;
  raise notice 'PASS: service_role has no TRUNCATE grant on drawing_findings_rejected';
end $$;

do $$
begin
  begin
    truncate drawing_findings_rejected;
    raise exception 'FAIL: service_role was able to TRUNCATE drawing_findings_rejected';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on drawing_findings_rejected is rejected for service_role (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
