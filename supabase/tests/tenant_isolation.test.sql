-- Proves tenant A cannot read (or write) tenant B's rows via RLS -- the global
-- engineering rule requires this test to exist for every tenant-scoped query
-- path (SS1). This asserts against the actual `authenticated` Postgres role
-- under RLS, not just "the UI doesn't show a button for it" -- see adversarial
-- self-check #4.
--
-- HOW TO RUN (this file has been WRITTEN but NOT EXECUTED in this environment --
-- Docker and psql are not installed here; see PHASE_0_FINDINGS.md SS1):
--   1. supabase start                 (starts local Postgres + applies migrations)
--   2. supabase db reset              (re-applies migrations + seed.sql)
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/tenant_isolation.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means an isolation gap.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh).
--
-- Also runs automatically on every push/PR via .github/workflows/ci.yml's
-- sql-tests job, which has Docker (ubuntu-latest runners) and so can
-- actually execute this file end-to-end -- unlike every sandbox this file
-- has been edited in so far.

begin;

-- Impersonate Org A's owner (seeded in supabase/seed.sql PART 2).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  visible_count int;
  org_b_row_count int;
begin
  select count(*) into visible_count from permit_applications;
  if visible_count <> 1 then
    raise exception 'FAIL: org A owner should see exactly 1 application, saw %', visible_count;
  end if;

  select count(*) into org_b_row_count
  from permit_applications
  where id = '40000000-0000-0000-0000-00000000000b';
  if org_b_row_count <> 0 then
    raise exception 'FAIL: org A owner could read org B''s application row';
  end if;

  raise notice 'PASS: org A owner sees only org A''s permit_applications row';
end $$;

-- Attempted cross-tenant UPDATE must affect zero rows (RLS filters the target
-- row out of the update's own visibility, it does not error).
do $$
declare
  updated_count int;
begin
  -- project_title was the original probe column; retargeted to `status`
  -- (Gate 1.3 privilege fix -- 20260806000022) because `authenticated` no
  -- longer holds any UPDATE grant on project_title at all (it was always
  -- INSERT-only in practice, see the Gate 1.3 report's column-privilege
  -- enumeration) -- an attempt against it now fails at the permission layer
  -- before RLS is ever evaluated, which is a different thing than what this
  -- check exists to prove. `status` is the one column `authenticated` has
  -- a real, legitimate UPDATE grant on, so this is still a same-org write
  -- that RLS's row-visibility filtering (not a permission wall) is what
  -- turns into 0 affected rows.
  update permit_applications
  set status = 'submitted'
  where id = '40000000-0000-0000-0000-00000000000b';
  get diagnostics updated_count = row_count;
  if updated_count <> 0 then
    raise exception 'FAIL: org A owner was able to UPDATE org B''s application row';
  end if;
  raise notice 'PASS: cross-tenant UPDATE affected 0 rows';
end $$;

-- application_documents is joined through permit_applications, not org-scoped
-- directly -- prove the join-based policy holds too.
--
-- GATE_2_0_FINDINGS.md SS E.3 flagged this block as vacuous in its original
-- form: it asserted a 0-row result for org B's application_id, but no
-- application_documents row for org B existed anywhere in this file or in
-- seed.sql, so the 0-row result proved nothing about RLS -- it would have
-- passed identically with application_documents_select deleted entirely.
-- Fixed by seeding a real org B row first, with a control check proving it
-- exists before org A's owner's RLS context is ever engaged for the read
-- below -- same discipline dashboard_queries.test.sql's own Part 1 control
-- check applies.
--
-- NOTE on how the fixture is inserted: the original draft of this fix used
-- `set local role service_role;` for this insert, mirroring the technique
-- this file already uses two blocks down for the audits/audit_findings
-- fixture. That failed here with "permission denied for table
-- application_documents" -- 20260806000015_service_role_grants.sql grants
-- service_role only `select, update` on this table, deliberately, not
-- `insert` (see that migration's own header comment: it's a scoped grant,
-- not a blanket one, and no prior migration grants it either). Adding the
-- missing grant would fix it but requires a migration, which is out of
-- scope for this change. So this control uses org B's own owner under
-- `authenticated` instead -- a legitimate same-org insert, RLS *engaged*
-- rather than bypassed, but WITH CHECK correctly allows it because it's org
-- B's own application. That's a materially different control than "RLS not
-- yet engaged": it proves the row is real by showing RLS's own INSERT policy
-- accepts it for the rightful owner, not by bypassing RLS. It still fully
-- defeats the original vacuousness problem (a real org B row now exists
-- prior to org A's read), which is the property this block exists to
-- restore.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  control_count int;
begin
  insert into application_documents (application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
  values ('40000000-0000-0000-0000-00000000000b', 'orgB/test.pdf', 'test.pdf', 'application/pdf', 1000,
          repeat('b', 64), 'other');

  select count(*) into control_count
  from application_documents
  where application_id = '40000000-0000-0000-0000-00000000000b';
  if control_count <> 1 then
    raise exception 'FAIL (control): expected 1 application_documents row for org B''s application under org B''s own RLS context (just inserted it), got % -- the later 0-row assertion under org A''s RLS context would prove nothing without this row existing', control_count;
  end if;
  raise notice 'PASS (control): org B''s own owner can see org B''s freshly-inserted application_documents row (count=1) -- the later 0-row result under org A''s RLS context is therefore RLS actively blocking a real match, not an empty match to begin with.';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  doc_count int;
begin
  insert into application_documents (application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
  values ('40000000-0000-0000-0000-00000000000a', 'orgA/test.pdf', 'test.pdf', 'application/pdf', 1000,
          repeat('a', 64), 'other');

  select count(*) into doc_count
  from application_documents
  where application_id = '40000000-0000-0000-0000-00000000000b';
  if doc_count <> 0 then
    raise exception 'FAIL: org A owner could see org B''s application_documents';
  end if;
  raise notice 'PASS: application_documents join-based isolation holds (control-verified above: a real org B row exists, and RLS -- not fixture absence -- is what hides it from org A)';
end $$;

-- audits/audit_findings are joined through permit_applications too (not
-- org-scoped directly), and are Phase 3 additions -- no seed data populates
-- them (no audit has actually run in this environment: no ANTHROPIC_API_KEY,
-- empty jurisdiction_code_chunks corpus), so this is the only place their RLS
-- policies get exercised against a real row rather than reviewed by
-- inspection alone. missing_document is used so code_chunk_id can stay null,
-- satisfying audit_findings' own check constraint without a real chunk.
--
-- Both tables have no INSERT policy for `authenticated` at all (by design --
-- these are service-role-only writes from the Inngest audit function, never
-- written directly by a contractor's own session), so the fixture row is
-- inserted as service_role (which bypasses RLS entirely), then read back
-- under `authenticated` to test the SELECT policy specifically. An earlier
-- draft of this test tried the insert as `authenticated` and correctly got
-- rejected by RLS -- that failure is itself evidence the missing INSERT
-- policy is doing its job, not a bug in this test file.
set local role service_role;

do $$
declare
  new_audit_id uuid;
begin
  insert into audits (application_id, model_id, prompt_version, corpus_version)
  values ('40000000-0000-0000-0000-00000000000a', 'test-model', 'test-prompt-v1', 'no-corpus-ingested')
  returning id into new_audit_id;

  insert into audit_findings (audit_id, kind, severity, issue, action_required, code_chunk_id, confidence)
  values (new_audit_id, 'missing_document', 'critical', 'test finding', 'test action', null, 1);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  finding_count int;
begin
  select count(*) into finding_count
  from audit_findings af
  join audits a on a.id = af.audit_id
  where a.application_id = '40000000-0000-0000-0000-00000000000a';
  if finding_count <> 1 then
    raise exception 'FAIL: org A owner could not see its own audit_findings row, saw %', finding_count;
  end if;

  raise notice 'PASS: org A owner can read its own audits/audit_findings rows';
end $$;

-- Switch to Org B's owner and confirm the mirror image holds.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from permit_applications;
  if visible_count <> 1 then
    raise exception 'FAIL: org B owner should see exactly 1 application, saw %', visible_count;
  end if;
  raise notice 'PASS: org B owner sees only org B''s permit_applications row';
end $$;

-- Mirror image of the audits/audit_findings check above: org B must not be
-- able to read the audit_findings row just inserted under org A's application
-- via the audits -> permit_applications join.
do $$
declare
  cross_tenant_finding_count int;
begin
  select count(*) into cross_tenant_finding_count
  from audit_findings af
  join audits a on a.id = af.audit_id
  where a.application_id = '40000000-0000-0000-0000-00000000000a';
  if cross_tenant_finding_count <> 0 then
    raise exception 'FAIL: org B owner could read org A''s audit_findings row';
  end if;
  raise notice 'PASS: org B owner cannot read org A''s audit_findings row';
end $$;

-- No JWT claim at all (anon) must see zero rows across every tenant table.
set local request.jwt.claims = '';
set local role anon;

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from permit_applications;
  if visible_count <> 0 then
    raise exception 'FAIL: anon role could see % permit_applications rows', visible_count;
  end if;
  raise notice 'PASS: anon role sees zero permit_applications rows';
end $$;

-- Reference data (jurisdictions) stays readable to any authenticated user
-- regardless of org, but should NOT be readable to anon.
do $$
declare
  jurisdiction_count int;
begin
  select count(*) into jurisdiction_count from jurisdictions;
  if jurisdiction_count <> 0 then
    raise exception 'FAIL: anon role could read % jurisdictions rows', jurisdiction_count;
  end if;
  raise notice 'PASS: anon role sees zero jurisdictions rows';
end $$;

rollback;
