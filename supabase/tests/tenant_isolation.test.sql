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
  update permit_applications
  set project_title = 'HACKED'
  where id = '40000000-0000-0000-0000-00000000000b';
  get diagnostics updated_count = row_count;
  if updated_count <> 0 then
    raise exception 'FAIL: org A owner was able to UPDATE org B''s application row';
  end if;
  raise notice 'PASS: cross-tenant UPDATE affected 0 rows';
end $$;

-- application_documents is joined through permit_applications, not org-scoped
-- directly -- prove the join-based policy holds too.
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
  raise notice 'PASS: application_documents join-based isolation holds';
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
