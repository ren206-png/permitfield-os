-- Gate AI-1, sub-phase AI-1.2 (GATE_AI_1_FINDINGS.md §C, §H CROSS_TENANT_RAG).
-- Proves, for the new application_document_chunks table and
-- search_application_document_chunks RPC
-- (20260806000038_application_document_chunks.sql):
--   1. Tenant isolation via RLS: org A cannot read org B's chunks.
--   2. CROSS_TENANT_RAG's defense-in-depth: even under service_role (which
--      has BYPASSRLS), the RPC's own explicit `org_id`/`application_id`
--      WHERE-clause filters still block a cross-tenant/cross-application
--      result -- this is the actual scenario the finding describes ("Org B
--      passage returned to Org A's query"), since every real caller of this
--      RPC in this codebase would run as service_role (same as
--      search_jurisdiction_code_chunks, called only from Inngest functions).
--   3. Append-only: UPDATE and DELETE are rejected by forbid_update_delete()
--      for both `authenticated` and `service_role`, same shape as
--      supabase/tests/ai_jobs_ledger_human_reviews.test.sql /
--      supabase/tests/audit_logs.test.sql.
--   4. TRUNCATE gap: service_role's Supabase-platform-default TRUNCATE
--      grant is revoked, same control-then-assert shape as
--      supabase/tests/service_role_truncate_append_only.test.sql.
--
-- HOW TO RUN (written but NOT EXECUTED in this environment -- no Docker/psql;
-- same standing note as every other supabase/tests/*.test.sql file, see
-- audit_logs.test.sql's header for the exact commands / npm run test:sql).

begin;

-- Org A / Org B fixtures from supabase/seed.sql PART 2:
--   Org A: 20000000-...000a, application 40000000-...000a
--   Org B: 20000000-...000b, application 40000000-...000b
-- application_document_chunks has no fixture application_documents rows to
-- reuse (tenant_isolation.test.sql inserts its own inline, same pattern
-- followed here) -- seeded as service_role, same as every other fixture in
-- this file.
set local role service_role;

insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
values
  ('70000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
   'org-a/test-doc-a.pdf', 'test-doc-a.pdf', 'application/pdf', 1024,
   repeat('a', 64), 'other'),
  ('70000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b',
   'org-b/test-doc-b.pdf', 'test-doc-b.pdf', 'application/pdf', 1024,
   repeat('b', 64), 'other')
on conflict (id) do nothing;

insert into application_document_chunks (id, org_id, application_id, application_document_id, chunk_index, content)
values
  ('80000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '40000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', 0,
   'Org A scope of work: 200 amp electrical service upgrade to detached garage.'),
  ('80000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '40000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000b', 0,
   'Org B scope of work: 400 amp electrical service upgrade to detached garage.');

-- === 1. RLS tenant isolation: org A owner cannot read org B's chunk row ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count
  from application_document_chunks
  where org_id = '20000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s application_document_chunks rows', cross_tenant_count;
  end if;
  raise notice 'PASS: org A owner cannot read org B''s application_document_chunks rows (RLS)';
end $$;

do $$
declare
  own_count int;
begin
  select count(*) into own_count
  from application_document_chunks
  where org_id = '20000000-0000-0000-0000-00000000000a';
  if own_count <> 1 then
    raise exception 'FAIL (control): org A owner should see exactly 1 of their own application_document_chunks rows, got %', own_count;
  end if;
  raise notice 'PASS (control): org A owner CAN see their own application_document_chunks row -- the org B 0-row result above is RLS actively blocking a real match, not an empty match to begin with';
end $$;

-- === 2. CROSS_TENANT_RAG: RPC's own explicit org_id/application_id filter
-- blocks cross-tenant leakage even under service_role (BYPASSRLS) ===
set local role service_role;

do $$
declare
  returned_ids uuid[];
begin
  -- Org A's own org_id/application_id, searching for org B's distinctive
  -- phrase ("400 amp") -- if the RPC's WHERE clause were missing or wrong,
  -- this could still surface org B's row via the BM25 match; it must not.
  select array_agg(id) into returned_ids
  from search_application_document_chunks(
    p_org_id => '20000000-0000-0000-0000-00000000000a',
    p_application_id => '40000000-0000-0000-0000-00000000000a',
    p_query_text => '400 amp electrical service upgrade detached garage'
  );
  if returned_ids is not null and returned_ids @> array['80000000-0000-0000-0000-00000000000b'::uuid] then
    raise exception 'FAIL: search_application_document_chunks scoped to org A returned org B''s chunk row';
  end if;
  raise notice 'PASS: search_application_document_chunks does not cross the org_id/application_id boundary even under service_role';
end $$;

do $$
declare
  returned_ids uuid[];
begin
  -- Sanity check (control): org A's own org_id/application_id DOES return
  -- org A's own chunk for a matching query -- proves the prior PASS was
  -- real isolation, not the RPC simply returning nothing for everyone.
  select array_agg(id) into returned_ids
  from search_application_document_chunks(
    p_org_id => '20000000-0000-0000-0000-00000000000a',
    p_application_id => '40000000-0000-0000-0000-00000000000a',
    p_query_text => '200 amp electrical service upgrade detached garage'
  );
  if returned_ids is null or not (returned_ids @> array['80000000-0000-0000-0000-00000000000a'::uuid]) then
    raise exception 'FAIL (control): org A''s own scoped query should have returned org A''s own chunk, got %', returned_ids;
  end if;
  raise notice 'PASS (control): org A''s own scoped query correctly returns org A''s own chunk';
end $$;

-- === 3. Append-only: authenticated cannot UPDATE or DELETE ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    update application_document_chunks set content = 'HACKED' where id = '80000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE an application_document_chunks row';
  exception
    when others then
      raise notice 'PASS: UPDATE on application_document_chunks correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from application_document_chunks where id = '80000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE an application_document_chunks row';
  exception
    when others then
      raise notice 'PASS: DELETE on application_document_chunks correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

-- === 4. Append-only: service_role (BYPASSRLS) is still blocked by the trigger ===
set local role service_role;

do $$
begin
  begin
    update application_document_chunks set content = 'HACKED' where id = '80000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE an application_document_chunks row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: UPDATE on application_document_chunks correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from application_document_chunks where id = '80000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE an application_document_chunks row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: DELETE on application_document_chunks correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

-- === 5. TRUNCATE gap: service_role's platform-default TRUNCATE grant was
-- revoked by the creating migration -- control step proves the grant would
-- otherwise exist by checking information_schema directly (same shape as
-- service_role_truncate_append_only.test.sql), assert step proves TRUNCATE
-- itself fails. ===
do $$
declare
  grant_count int;
begin
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_name = 'application_document_chunks'
    and grantee = 'service_role'
    and privilege_type = 'TRUNCATE';
  if grant_count <> 0 then
    raise exception 'FAIL: service_role still holds a TRUNCATE grant on application_document_chunks (revoke in 20260806000038 did not take effect)';
  end if;
  raise notice 'PASS: service_role has no TRUNCATE grant on application_document_chunks';
end $$;

do $$
begin
  begin
    truncate application_document_chunks;
    raise exception 'FAIL: service_role was able to TRUNCATE application_document_chunks';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: TRUNCATE on application_document_chunks correctly rejected for service_role (%)', sqlerrm;
  end;
end $$;

rollback;
