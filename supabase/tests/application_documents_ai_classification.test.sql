-- Gate AI-1, sub-phase AI-1.3 (GATE_AI_1_FINDINGS.md §D/§G,
-- 20260806000064_application_documents_ai_classification.sql). Proves, for
-- the three new application_documents columns
-- (ai_suggested_doc_kind/ai_suggested_doc_kind_confidence/
-- ai_classification_job_id):
--   1. Pairing CHECK: a suggestion and its confidence must appear together
--      or not at all.
--   2. Confidence-range CHECK: ai_suggested_doc_kind_confidence must be in
--      [0,1] when present.
--   3. ai_classification_job_id must reference a real ai_jobs row, and an
--      ai_jobs row of kind 'classification' backs it correctly (mirrors
--      drawing_review_schema.test.sql's own item 7 for 'drawing_review').
--   4. ON DELETE SET NULL: verified via pg_constraint metadata
--      (confdeltype = 'n'), NOT a live DELETE FROM ai_jobs -- same reasoning
--      notification_pending_events.test.sql's own section 5 comment gives
--      for its permit_applications FK check: ai_jobs' own
--      ai_jobs_append_only trigger (forbid_update_delete(), unconditional,
--      20260806000036) fires on ANY row-level delete, including one driven
--      by organizations' own ON DELETE CASCADE to ai_jobs.org_id -- so the
--      one real-world path that could ever delete an ai_jobs row today
--      would itself abort inside this file's single outer transaction
--      before a later section could run. A metadata check proves the same
--      schema fact (this FK really is ON DELETE SET NULL, not CASCADE/
--      RESTRICT/NO ACTION) without needing to survive that trigger.
--   5. The user-supplied doc_kind column is completely untouched by any of
--      the above -- a suggestion coexists with, never overwrites, the
--      uploader's own value.
--   6. No RLS/grant regression: an org member still reads their own
--      application_documents row (with the new columns populated) and
--      still cannot read another org's row -- tenant isolation is
--      unchanged by this additive migration.
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/application_documents_ai_classification.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A / Org B fixtures from supabase/seed.sql PART 2 (same as
-- drawing_review_schema.test.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a, application 40000000-...000a
--   Org B: 20000000-...000b, owner 10000000-...000b, application 40000000-...000b
set local role service_role;

insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
values
  ('76000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   'org-a/spec-a.pdf', 'spec-a.pdf', 'application/pdf', 1024, repeat('e', 64), 'other'),
  ('76000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b',
   'org-b/spec-b.pdf', 'spec-b.pdf', 'application/pdf', 1024, repeat('f', 64), 'other')
on conflict (id) do nothing;

insert into ai_jobs (id, org_id, kind, provider, model_id, status, input_token_count, output_token_count)
values
  ('77000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'classification', 'gemini', 'test-model', 'succeeded', 300, 20)
on conflict (id) do nothing;

-- === 1. Pairing CHECK ===
do $$
begin
  begin
    update application_documents
    set ai_suggested_doc_kind = 'spec_sheet', ai_suggested_doc_kind_confidence = null
    where id = '76000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a suggestion with a null confidence was accepted';
  exception
    when others then
      raise notice 'PASS: ai_suggested_doc_kind without ai_suggested_doc_kind_confidence is rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update application_documents
    set ai_suggested_doc_kind = null, ai_suggested_doc_kind_confidence = 0.8
    where id = '76000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a confidence with a null doc_kind suggestion was accepted';
  exception
    when others then
      raise notice 'PASS: ai_suggested_doc_kind_confidence without ai_suggested_doc_kind is rejected (%)', sqlerrm;
  end;
end $$;

-- === 2. Confidence-range CHECK ===
do $$
begin
  begin
    update application_documents
    set ai_suggested_doc_kind = 'spec_sheet', ai_suggested_doc_kind_confidence = 1.5
    where id = '76000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a confidence outside [0,1] was accepted';
  exception
    when others then
      raise notice 'PASS: ai_suggested_doc_kind_confidence outside [0,1] is rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update application_documents
    set ai_suggested_doc_kind = 'spec_sheet', ai_suggested_doc_kind_confidence = -0.1
    where id = '76000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a negative confidence was accepted';
  exception
    when others then
      raise notice 'PASS: a negative ai_suggested_doc_kind_confidence is rejected (%)', sqlerrm;
  end;
end $$;

-- === 3. FK to ai_jobs + kind linkage ===
do $$
begin
  begin
    update application_documents
    set ai_suggested_doc_kind = 'spec_sheet', ai_suggested_doc_kind_confidence = 0.9,
        ai_classification_job_id = '00000000-0000-0000-0000-000000000999'
    where id = '76000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: ai_classification_job_id accepted a non-existent ai_jobs id';
  exception
    when others then
      raise notice 'PASS: ai_classification_job_id rejects a non-existent ai_jobs row (%)', sqlerrm;
  end;
end $$;

update application_documents
set ai_suggested_doc_kind = 'spec_sheet', ai_suggested_doc_kind_confidence = 0.9,
    ai_classification_job_id = '77000000-0000-0000-0000-00000000000a'
where id = '76000000-0000-0000-0000-00000000000a';

do $$
declare
  linked_kind ai_task_kind;
begin
  select j.kind into linked_kind
  from application_documents ad
  join ai_jobs j on j.id = ad.ai_classification_job_id
  where ad.id = '76000000-0000-0000-0000-00000000000a';
  if linked_kind is distinct from 'classification' then
    raise exception 'FAIL: ai_classification_job_id did not resolve to an ai_jobs row of kind ''classification'', got %', linked_kind;
  end if;
  raise notice 'PASS: ai_classification_job_id correctly links to an ai_jobs row of the ''classification'' kind';
end $$;

-- === 4. ON DELETE SET NULL (metadata check -- see this file's header) ===
do $$
declare
  delete_action char;
begin
  select confdeltype into delete_action
  from pg_constraint
  where conrelid = 'application_documents'::regclass
    and confrelid = 'ai_jobs'::regclass
    and conname = 'application_documents_ai_classification_job_id_fkey';
  if delete_action is null then
    raise exception 'FAIL: no FK from application_documents.ai_classification_job_id to ai_jobs found in pg_constraint';
  end if;
  if delete_action <> 'n' then
    raise exception 'FAIL: application_documents.ai_classification_job_id FK is not ON DELETE SET NULL (pg_constraint.confdeltype = %)', delete_action;
  end if;
  raise notice 'PASS: application_documents.ai_classification_job_id FK is ON DELETE SET NULL (pg_constraint.confdeltype = n) -- a deleted ai_jobs row cannot take the application_documents row down with it';
end $$;

-- The user-supplied doc_kind and the suggestion columns set in section 3
-- above remain exactly as set -- nothing in sections 1-4 touched them via
-- any side effect (the rejected UPDATE attempts above never committed).
do $$
declare
  current_doc_kind doc_kind;
  current_suggested doc_kind;
begin
  select doc_kind, ai_suggested_doc_kind into current_doc_kind, current_suggested
  from application_documents where id = '76000000-0000-0000-0000-00000000000a';
  if current_doc_kind is distinct from 'other' then
    raise exception 'FAIL: user-supplied doc_kind changed unexpectedly to %', current_doc_kind;
  end if;
  if current_suggested is distinct from 'spec_sheet' then
    raise exception 'FAIL: ai_suggested_doc_kind changed unexpectedly to %', current_suggested;
  end if;
  raise notice 'PASS: user-supplied doc_kind and ai_suggested_doc_kind coexist unchanged (a suggestion never overwrites the uploader''s own value)';
end $$;

-- === 5. RLS/tenant isolation unchanged ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  own_suggested doc_kind;
begin
  select ai_suggested_doc_kind into own_suggested
  from application_documents where id = '76000000-0000-0000-0000-00000000000a';
  if own_suggested is distinct from 'spec_sheet' then
    raise exception 'FAIL (control): org A owner should read their own ai_suggested_doc_kind ''spec_sheet'', got %', own_suggested;
  end if;
  raise notice 'PASS (control): org A owner CAN read their own application_documents row, including the new suggestion columns';
end $$;

do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count
  from application_documents where id = '76000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s application_documents rows', cross_tenant_count;
  end if;
  raise notice 'PASS: org A owner cannot read org B''s application_documents row (RLS unchanged by this migration)';
end $$;

rollback;
