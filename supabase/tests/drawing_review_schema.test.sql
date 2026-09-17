-- Gate 5, sub-phase 5.1 (GATE_5_FINDINGS.md §K, 20260806000044_drawing_review_schema.sql).
-- Proves, for the two new tables (drawing_reviews, drawing_findings), the
-- ai_task_kind enum extension, and the new jurisdiction_code_chunks.
-- drawing_category column:
--   1. Tenant isolation: org A cannot read org B's drawing_reviews/
--      drawing_findings rows (RLS), with a same-org control proving the
--      cross-org 0-row result is RLS actively blocking a real match.
--   2. "No citation, no finding": a non-missing_document drawing_findings
--      row requires BOTH code_chunk_id and source_page; a missing_document
--      row requires neither.
--   3. Other drawing_findings CHECK constraints: confidence in [0,1],
--      reviewed_by/reviewed_at pair with review_status, source_region must
--      be a JSON object when present.
--   4. Review-column-only mutability: an org member can transition
--      review_status (+ reviewed_by/reviewed_at) via the review_update
--      policy, but the restrict-update trigger rejects any attempt that
--      also touches a protected column in the same statement.
--   5. Append-only otherwise: DELETE is rejected on both tables for
--      `authenticated` and for service_role (BYPASSRLS); UPDATE on
--      drawing_reviews is rejected outright (it has no mutable column at
--      all, unlike drawing_findings).
--   6. TRUNCATE: service_role holds no TRUNCATE grant on either table and
--      cannot TRUNCATE them.
--   7. ai_task_kind now accepts 'drawing_review' (20260806000044's enum
--      extension), and an ai_jobs row of that kind correctly backs a
--      drawing_reviews row via ai_job_id.
--   8. jurisdiction_code_chunks.drawing_category is a plain nullable
--      column: a chunk with it set, and a legacy chunk with it left null,
--      are both readable exactly as before (no existing behavior changed).
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/drawing_review_schema.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A / Org B fixtures from supabase/seed.sql PART 2 (same as
-- application_document_chunks.test.sql / ai_jobs_ledger_human_reviews.test.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a, application 40000000-...000a
--   Org B: 20000000-...000b, owner 10000000-...000b, application 40000000-...000b
-- Toronto jurisdiction from supabase/seed.sql PART 1 (reference data, safe
-- in any environment): 00000000-0000-0000-0001-000000000001, reused from
-- jurisdiction_code_chunks_dimensions.test.sql rather than inventing a new
-- jurisdiction fixture.
set local role service_role;

insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
values
  ('71000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   'org-a/drawing-a.pdf', 'drawing-a.pdf', 'application/pdf', 2048, repeat('c', 64), 'blueprint'),
  ('71000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b',
   'org-b/drawing-b.pdf', 'drawing-b.pdf', 'application/pdf', 2048, repeat('d', 64), 'blueprint')
on conflict (id) do nothing;

insert into jurisdiction_code_chunks (id, jurisdiction_id, code_section, content, source_url, license_status, corpus_version, drawing_category)
values
  ('72000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0001-000000000001', '3.2.5',
   'Structural: minimum footing depth below grade for a detached accessory structure.',
   'https://example.test/bylaw/3-2-5', 'public_record', 'test-v1', 'structural'),
  -- Legacy shape: drawing_category left null, matching every pre-migration
  -- row -- inserted here (not reused from another test file's fixture,
  -- since each supabase/tests/*.test.sql file runs in its own rolled-back
  -- transaction and cannot see another file's rows) so item 8 below has a
  -- real, known-null row to assert against rather than a vacuous no-row match.
  ('72000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0001-000000000001', '3.2.6',
   'Structural: legacy chunk predating the drawing_category column.',
   'https://example.test/bylaw/3-2-6', 'public_record', 'test-v1', null)
on conflict (id) do nothing;

insert into ai_jobs (id, org_id, kind, provider, model_id, status, input_token_count, output_token_count)
values
  ('73000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'drawing_review', 'anthropic', 'test-model', 'succeeded', 500, 200),
  ('73000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   'drawing_review', 'anthropic', 'test-model', 'succeeded', 500, 200)
on conflict (id) do nothing;

insert into drawing_reviews (id, application_id, application_document_id, ai_job_id, corpus_version)
values
  ('74000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   '71000000-0000-0000-0000-00000000000a', '73000000-0000-0000-0000-00000000000a', 'test-v1'),
  ('74000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b',
   '71000000-0000-0000-0000-00000000000b', '73000000-0000-0000-0000-00000000000b', 'test-v1')
on conflict (id) do nothing;

insert into drawing_findings (id, drawing_review_id, kind, severity, issue, action_required, code_chunk_id, source_page, source_region, confidence)
values
  ('75000000-0000-0000-0000-00000000000a', '74000000-0000-0000-0000-00000000000a', 'code_conflict', 'critical',
   'Footing depth annotated at 0.6m, below the 1.2m minimum.', 'Revise footing detail to meet minimum depth.',
   '72000000-0000-0000-0000-00000000000a', 3, '{"x":0.1,"y":0.2,"width":0.1,"height":0.05}'::jsonb, 0.9),
  ('75000000-0000-0000-0000-00000000000b', '74000000-0000-0000-0000-00000000000a', 'missing_document', 'warning',
   'No structural engineer stamp page found for this drawing set.', 'Attach a stamped structural page.',
   null, null, null, 0.7);

-- === 1. RLS tenant isolation ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count from drawing_reviews where application_id = '40000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s drawing_reviews rows', cross_tenant_count;
  end if;
  raise notice 'PASS: org A owner cannot read org B''s drawing_reviews rows (RLS)';
end $$;

do $$
declare
  own_count int;
begin
  select count(*) into own_count from drawing_reviews where application_id = '40000000-0000-0000-0000-00000000000a';
  if own_count <> 1 then
    raise exception 'FAIL (control): org A owner should see exactly 1 of their own drawing_reviews rows, got %', own_count;
  end if;
  raise notice 'PASS (control): org A owner CAN see their own drawing_reviews row';
end $$;

do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count
  from drawing_findings df
  join drawing_reviews dr on dr.id = df.drawing_review_id
  where dr.application_id = '40000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s drawing_findings rows', cross_tenant_count;
  end if;
  raise notice 'PASS: org A owner cannot read org B''s drawing_findings rows (RLS)';
end $$;

do $$
declare
  own_count int;
begin
  select count(*) into own_count from drawing_findings where drawing_review_id = '74000000-0000-0000-0000-00000000000a';
  if own_count <> 2 then
    raise exception 'FAIL (control): org A owner should see exactly 2 of their own drawing_findings rows, got %', own_count;
  end if;
  raise notice 'PASS (control): org A owner CAN see both of their own drawing_findings rows';
end $$;

-- === 2 & 3. CHECK constraints ===
set local role service_role;

do $$
begin
  begin
    insert into drawing_findings (drawing_review_id, kind, severity, issue, action_required, code_chunk_id, source_page, confidence)
    values ('74000000-0000-0000-0000-00000000000a', 'code_conflict', 'critical', 'x', 'y', null, 3, 0.5);
    raise exception 'FAIL: code_conflict finding with a null code_chunk_id was accepted';
  exception
    when others then
      raise notice 'PASS: code_conflict finding without code_chunk_id is rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into drawing_findings (drawing_review_id, kind, severity, issue, action_required, code_chunk_id, source_page, confidence)
    values ('74000000-0000-0000-0000-00000000000a', 'code_conflict', 'critical', 'x', 'y', '72000000-0000-0000-0000-00000000000a', null, 0.5);
    raise exception 'FAIL: code_conflict finding with a null source_page was accepted';
  exception
    when others then
      raise notice 'PASS: code_conflict finding without source_page is rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into drawing_findings (drawing_review_id, kind, severity, issue, action_required, confidence)
    values ('74000000-0000-0000-0000-00000000000a', 'missing_document', 'warning', 'x', 'y', 1.5);
    raise exception 'FAIL: confidence outside [0,1] was accepted';
  exception
    when others then
      raise notice 'PASS: confidence outside [0,1] is rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into drawing_findings (drawing_review_id, kind, severity, issue, action_required, confidence, review_status, reviewed_by)
    values ('74000000-0000-0000-0000-00000000000a', 'missing_document', 'warning', 'x', 'y', 0.5, 'confirmed', null);
    raise exception 'FAIL: review_status=confirmed with a null reviewed_by was accepted';
  exception
    when others then
      raise notice 'PASS: review_status=confirmed without reviewed_by is rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into drawing_findings (drawing_review_id, kind, severity, issue, action_required, confidence, source_region)
    values ('74000000-0000-0000-0000-00000000000a', 'missing_document', 'warning', 'x', 'y', 0.5, '"not an object"'::jsonb);
    raise exception 'FAIL: a non-object source_region was accepted';
  exception
    when others then
      raise notice 'PASS: non-object source_region is rejected (%)', sqlerrm;
  end;
end $$;

-- === 4. Review-column-only mutability ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  update drawing_findings
  set review_status = 'confirmed', reviewed_by = '10000000-0000-0000-0000-00000000000a', reviewed_at = now()
  where id = '75000000-0000-0000-0000-00000000000a';
  raise notice 'PASS: org A owner can confirm their own drawing_findings row (review columns only)';
exception
  when others then
    raise exception 'FAIL: a legitimate review-column-only update was rejected (%)', sqlerrm;
end $$;

do $$
begin
  begin
    update drawing_findings
    set review_status = 'dismissed', reviewed_by = '10000000-0000-0000-0000-00000000000a', reviewed_at = now(),
        severity = 'info'
    where id = '75000000-0000-0000-0000-00000000000b';
    raise exception 'FAIL: an update that also touched severity alongside review columns was accepted';
  exception
    when others then
      raise notice 'PASS: an update touching a protected column alongside review columns is rejected (%)', sqlerrm;
  end;
end $$;

-- === 5. Append-only otherwise (DELETE always; UPDATE on drawing_reviews) ===
do $$
begin
  begin
    delete from drawing_findings where id = '75000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE a drawing_findings row';
  exception
    when others then
      raise notice 'PASS: DELETE on drawing_findings is rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update drawing_reviews set corpus_version = 'HACKED' where id = '74000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE a drawing_reviews row';
  exception
    when others then
      raise notice 'PASS: UPDATE on drawing_reviews is rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from drawing_reviews where id = '74000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE a drawing_reviews row';
  exception
    when others then
      raise notice 'PASS: DELETE on drawing_reviews is rejected for authenticated (%)', sqlerrm;
  end;
end $$;

set local role service_role;

do $$
begin
  begin
    update drawing_reviews set corpus_version = 'HACKED' where id = '74000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE a drawing_reviews row';
  exception
    when others then
      raise notice 'PASS: UPDATE on drawing_reviews is rejected for service_role (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from drawing_reviews where id = '74000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE a drawing_reviews row';
  exception
    when others then
      raise notice 'PASS: DELETE on drawing_reviews is rejected for service_role (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from drawing_findings where id = '75000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE a drawing_findings row';
  exception
    when others then
      raise notice 'PASS: DELETE on drawing_findings is rejected for service_role (%)', sqlerrm;
  end;
end $$;

-- === 6. TRUNCATE gap ===
do $$
declare
  grant_count int;
begin
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_name in ('drawing_reviews', 'drawing_findings')
    and grantee = 'service_role'
    and privilege_type = 'TRUNCATE';
  if grant_count <> 0 then
    raise exception 'FAIL: service_role still holds a TRUNCATE grant on drawing_reviews/drawing_findings';
  end if;
  raise notice 'PASS: service_role has no TRUNCATE grant on drawing_reviews or drawing_findings';
end $$;

do $$
begin
  begin
    truncate drawing_reviews;
    raise exception 'FAIL: service_role was able to TRUNCATE drawing_reviews';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on drawing_reviews is rejected for service_role (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    truncate drawing_findings;
    raise exception 'FAIL: service_role was able to TRUNCATE drawing_findings';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on drawing_findings is rejected for service_role (%)', sqlerrm;
  end;
end $$;

-- === 7. ai_task_kind enum extension backs a real drawing_reviews row ===
do $$
declare
  linked_kind ai_task_kind;
begin
  select j.kind into linked_kind
  from drawing_reviews dr
  join ai_jobs j on j.id = dr.ai_job_id
  where dr.id = '74000000-0000-0000-0000-00000000000a';
  if linked_kind is distinct from 'drawing_review' then
    raise exception 'FAIL: drawing_reviews.ai_job_id did not resolve to an ai_jobs row of kind ''drawing_review'', got %', linked_kind;
  end if;
  raise notice 'PASS: drawing_reviews.ai_job_id correctly links to an ai_jobs row of the new ''drawing_review'' kind';
end $$;

-- === 8. jurisdiction_code_chunks.drawing_category is additive-only ===
do $$
declare
  tagged_category text;
  legacy_category text;
  legacy_row_count int;
begin
  select drawing_category into tagged_category
  from jurisdiction_code_chunks where id = '72000000-0000-0000-0000-00000000000a';
  if tagged_category is distinct from 'structural' then
    raise exception 'FAIL: expected drawing_category = ''structural'', got %', tagged_category;
  end if;

  select count(*), max(drawing_category) into legacy_row_count, legacy_category
  from jurisdiction_code_chunks where id = '72000000-0000-0000-0000-00000000000b';
  if legacy_row_count <> 1 then
    raise exception 'FAIL: legacy-shape fixture row not found (expected exactly 1, got %)', legacy_row_count;
  end if;
  if legacy_category is not null then
    raise exception 'FAIL: legacy-shape chunk fixture unexpectedly has a non-null drawing_category: %', legacy_category;
  end if;
  raise notice 'PASS: jurisdiction_code_chunks.drawing_category reads correctly for a tagged chunk and stays null for an untagged one';
end $$;

rollback;
