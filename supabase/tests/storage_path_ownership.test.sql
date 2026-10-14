-- 20260806000089_storage_path_ownership.sql.
-- Proves:
--   1. is_application_storage_path() accepts buildStoragePath()'s shape and
--      rejects other prefixes, '..' segments (plain and percent-encoded),
--      '//', backslashes and control characters.
--   2. A signed-in member cannot insert an application_documents row (via
--      the application_documents_insert RLS policy) whose path points at
--      another org's folder or climbs out with '../'.
--   3. replace_application_document() rejects the same paths and writes
--      nothing.
--   4. The triggers on generated_documents and document_revisions, and on a
--      change of application_id, enforce the rule for every writer,
--      including the service role and the table owner.
--
-- Fixtures (supabase/seed.sql):
--   Org A: 20000000-...000a, owner 10000000-...000a, application 40000000-...000a
--   Org B: 20000000-...000b, owner 10000000-...000b, application 40000000-...000b

begin;

-- === 1. The predicate ===
do $$
declare
  v_org_a uuid := '20000000-0000-0000-0000-00000000000a';
  v_app_a uuid := '40000000-0000-0000-0000-00000000000a';
  v_prefix text := '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/';
  v_path text;
begin
  if not is_application_storage_path(v_prefix || repeat('a', 64) || '-Site_plan.v2.pdf', v_org_a, v_app_a) then
    raise exception 'FAIL: a buildStoragePath()-shaped path was rejected';
  end if;

  foreach v_path in array array[
    '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/x.pdf',
    '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000a/x.pdf',
    v_prefix,
    v_prefix || '../../20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/x.pdf',
    v_prefix || 'sub/../x.pdf',
    v_prefix || '..',
    v_prefix || '%2e%2e/%2e%2e/20000000-0000-0000-0000-00000000000b/x.pdf',
    v_prefix || '.%2e/x.pdf',
    v_prefix || E'.\t./x.pdf',
    v_prefix || E'.\n./x.pdf',
    v_prefix || '/x.pdf',
    v_prefix || 'a//x.pdf',
    v_prefix || E'..\\x.pdf',
    v_prefix || 'x.pdf?y',
    'x/y/z.pdf',
    ''
  ] loop
    if is_application_storage_path(v_path, v_org_a, v_app_a) then
      raise exception 'FAIL: is_application_storage_path accepted %', v_path;
    end if;
  end loop;

  if is_application_storage_path(null, v_org_a, v_app_a) is distinct from false
     or is_application_storage_path(v_prefix || 'x.pdf', null, v_app_a) is distinct from false then
    raise exception 'FAIL: is_application_storage_path should return false (not null) for null inputs';
  end if;
  raise notice 'PASS: is_application_storage_path accepts the app''s own shape and rejects other orgs, traversal and odd characters.';
end $$;

-- === 2. Direct insert under RLS (the application_documents_insert policy) ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_path text;
  v_count int;
begin
  foreach v_path in array array[
    -- Another org's application folder.
    '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('1', 64) || '-stolen.pdf',
    -- Own prefix, then '../' out into Org B's folder.
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/../../20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('1', 64) || '-stolen.pdf',
    -- The same, percent-encoded.
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/%2e%2e/%2e%2e/20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('1', 64) || '-stolen.pdf'
  ] loop
    begin
      insert into application_documents (application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
      values ('40000000-0000-0000-0000-00000000000a', v_path, 'stolen.pdf', 'application/pdf', 1000, repeat('1', 64), 'other');
      raise exception 'FAIL: Org A member inserted an application_documents row with path %', v_path;
    exception
      when others then
        if sqlerrm not like 'invalid_path%' then raise; end if;
    end;
  end loop;

  select count(*) into v_count from application_documents where sha256 = repeat('1', 64);
  if v_count <> 0 then
    raise exception 'FAIL: % rejected application_documents row(s) were written', v_count;
  end if;

  -- Control: the app's own path shape is accepted through the same policy.
  insert into application_documents (id, application_id, storage_path, original_filename, mime_type, byte_size, sha256, doc_kind)
  values ('78000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
          '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/' || repeat('2', 64) || '-own.pdf',
          'own.pdf', 'application/pdf', 1000, repeat('2', 64), 'other');

  raise notice 'PASS: a member cannot insert a document row pointing at another org''s folder or using ../ (plain or encoded); the app''s own path is accepted.';
end $$;

-- === 3. replace_application_document() ===
do $$
declare
  v_path text;
  v_revisions int;
  v_current text;
begin
  foreach v_path in array array[
    '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('3', 64) || '-stolen.pdf',
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/../../20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('3', 64) || '-stolen.pdf'
  ] loop
    begin
      perform replace_application_document(
        '78000000-0000-0000-0000-00000000000a',
        v_path, 'stolen.pdf', 'application/pdf', 1000, repeat('3', 64),
        '\x255044462d312e34'::bytea
      );
      raise exception 'FAIL: replace_application_document() accepted path %', v_path;
    exception
      when others then
        if sqlerrm not like 'invalid_path%' then raise; end if;
    end;
  end loop;

  select count(*) into v_revisions from document_revisions where application_document_id = '78000000-0000-0000-0000-00000000000a';
  select storage_path into v_current from application_documents where id = '78000000-0000-0000-0000-00000000000a';
  if v_revisions <> 1 or v_current not like '%-own.pdf' then
    raise exception 'FAIL: a rejected replace wrote something (revisions=%, current path=%)', v_revisions, v_current;
  end if;

  -- Control: a path under the document's own application is accepted.
  perform replace_application_document(
    '78000000-0000-0000-0000-00000000000a',
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/' || repeat('4', 64) || '-own-v2.pdf',
    'own-v2.pdf', 'application/pdf', 1000, repeat('4', 64),
    '\x255044462d312e34'::bytea
  );

  raise notice 'PASS: replace_application_document() rejects cross-org and ../ paths without writing, and accepts the document''s own folder.';
end $$;

-- === 4. Every writer, every table ===
reset role;
set local role service_role;

do $$
declare
  v_path text;
begin
  foreach v_path in array array[
    '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('5', 64) || '-filled.pdf',
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/../../20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('5', 64) || '-filled.pdf'
  ] loop
    begin
      insert into generated_documents (application_id, permit_type_filing_id, storage_path, original_filename, fill_method)
      values ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001', v_path, 'filled.pdf', 'acroform');
      raise exception 'FAIL: service_role inserted a generated_documents row with path %', v_path;
    exception
      when others then
        if sqlerrm not like 'invalid_path%' then raise; end if;
    end;
  end loop;
  raise notice 'PASS: generated_documents rejects cross-org and ../ paths, even from the service role.';
end $$;

reset role;

do $$
begin
  -- document_revisions has no write grant for any API role; the table owner
  -- (and the definer functions that write it) still go through the trigger.
  begin
    insert into document_revisions (application_document_id, revision_number, storage_path, original_filename, mime_type, byte_size, sha256)
    values ('78000000-0000-0000-0000-00000000000a', 50,
            '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000b/' || repeat('6', 64) || '-stolen.pdf',
            'stolen.pdf', 'application/pdf', 1000, repeat('6', 64));
    raise exception 'FAIL: document_revisions accepted another org''s path';
  exception
    when others then
      if sqlerrm not like 'invalid_path%' then raise; end if;
  end;

  -- Moving a row to another org's application while keeping its old path.
  begin
    update application_documents set application_id = '40000000-0000-0000-0000-00000000000b'
    where id = '78000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: application_documents row moved to another application with its old path';
  exception
    when others then
      if sqlerrm not like 'invalid_path%' then raise; end if;
  end;
  raise notice 'PASS: document_revisions and a change of application_id are checked too.';
end $$;

rollback;
