-- Database-level ownership check for document storage paths (follow-up to
-- the 2026-10-11 security review).
--
-- application_documents, document_revisions and generated_documents store a
-- storage_path that server code later reads with the service-role client
-- (lib/inngest/functions/extract.ts, classify-documents.ts, drawing-review.ts,
-- lib/bridge/client-portal.ts createSignedUrl, lib/submissions/submit.ts).
-- The service role bypasses the storage.objects RLS policies, so a row that
-- points at another org's object would hand that object out. Nothing in the
-- database tied the path to the row's own application:
--   - the application_documents_insert RLS policy only checks
--     is_org_member() for the row's application, not storage_path;
--   - replace_application_document() (SECURITY DEFINER, callable by any
--     signed-in user over /rest/v1/rpc) stored p_storage_path unchecked.
--
-- 1. is_application_storage_path(): the one place the rule lives. A path
--    must be '<org_id>/<application_id>/' followed by one or more segments
--    made only of [A-Za-z0-9._-], and no segment may be '..'. That is
--    exactly what lib/storage/documents.ts buildStoragePath() produces
--    (unchanged since the initial commit). The character allowlist also
--    rules out '//' (empty segment) and backslashes, as migration
--    20260806000087 did for record_uploaded_signed_form(), and it
--    closes two bypasses of a plain '..' check: storage-js puts the path
--    into the request URL unencoded, and URL parsing treats '%2e%2e' as
--    '..' and strips tabs and newlines.
--
-- 2. A BEFORE INSERT OR UPDATE trigger on all three tables enforces it.
--    document_revisions resolves its application through
--    application_document_id. The trigger also fires when the row's parent
--    key changes, so a row cannot be moved under another application while
--    keeping its old path.
--
-- 3. replace_application_document() checks p_storage_path itself as well,
--    right after its authorization checks, so the caller gets a clear error
--    before any revision is written. The body is otherwise unchanged from
--    20260806000024.
--
-- Existing rows are not re-validated (the trigger only sees new writes); in
-- production every row already matched this rule on 2026-10-11.

create or replace function public.is_application_storage_path(
  p_path text,
  p_org_id uuid,
  p_application_id uuid
)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(
    starts_with(p_path, p_org_id::text || '/' || p_application_id::text || '/')
      and substr(p_path, 75) ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
      and p_path !~ '(^|/)\.\.(/|$)',
    false
  );
$function$;

revoke all on function public.is_application_storage_path(text, uuid, uuid) from public, anon, authenticated;

-- SECURITY DEFINER so the parent lookups see the row regardless of the
-- writer's RLS visibility. Trigger functions need no EXECUTE grant to fire.
create or replace function public.enforce_document_storage_path()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_application_id uuid;
  v_org_id uuid;
begin
  if tg_table_name = 'document_revisions' then
    select application_id into v_application_id from application_documents where id = new.application_document_id;
  else
    v_application_id := new.application_id;
  end if;
  select org_id into v_org_id from permit_applications where id = v_application_id;

  if not is_application_storage_path(new.storage_path, v_org_id, v_application_id) then
    raise exception 'invalid_path: the file must be stored under this application';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_document_storage_path() from public, anon, authenticated;

create trigger application_documents_storage_path_check
  before insert or update of storage_path, application_id on application_documents
  for each row execute function enforce_document_storage_path();

create trigger document_revisions_storage_path_check
  before insert or update of storage_path, application_document_id on document_revisions
  for each row execute function enforce_document_storage_path();

create trigger generated_documents_storage_path_check
  before insert or update of storage_path, application_id on generated_documents
  for each row execute function enforce_document_storage_path();

create or replace function replace_application_document(
  p_application_document_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_sha256 char(64),
  p_header bytea
)
returns application_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc application_documents;
  v_org_id uuid;
  v_role org_role;
  v_next_revision int;
begin
  -- Lock the parent row first. This is what actually prevents the
  -- revision_number gap the unique constraint on document_revisions guards
  -- against under ordinary concurrent calls: two concurrent
  -- replace_application_document() calls for the SAME document serialize on
  -- this lock, so the second call's v_next_revision computation (below)
  -- only runs after the first call's insert is either committed or rolled
  -- back. The unique constraint is the hard backstop for anything this lock
  -- doesn't cover, per 20260806000024's header comment.
  select * into v_doc from application_documents where id = p_application_document_id for update;
  if v_doc.id is null then
    raise exception 'application_document % not found', p_application_document_id;
  end if;

  select pa.org_id into v_org_id from permit_applications pa where pa.id = v_doc.application_id;
  if v_org_id is null or not is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Role check mirrors lib/authz/index.ts's matrix: every role with
  -- 'create' against the application_documents resource, i.e. every role
  -- EXCEPT auditor_readonly and client_user (neither has a 'create' entry
  -- for application_documents in that matrix at all).
  select role into v_role from org_members where org_id = v_org_id and user_id = auth.uid();
  if v_role not in (
    'owner', 'org_owner', 'platform_admin', 'member',
    'permit_manager', 'permit_coordinator', 'document_reviewer', 'applicant_contractor'
  ) then
    raise exception 'insufficient_privilege: role % may not upload a new document revision', v_role
      using errcode = '42501';
  end if;

  if v_doc.archived_at is not null then
    raise exception 'document_archived: application_document % has been archived and cannot receive a new revision', p_application_document_id;
  end if;

  -- The new revision must live under this document's own application
  -- (20260806000088). The storage_path triggers enforce the same rule; this
  -- fails earlier, with nothing written.
  if not is_application_storage_path(p_storage_path, v_org_id, v_doc.application_id) then
    raise exception 'invalid_path: the file must be stored under this application';
  end if;

  -- Defense in depth (20260806000024's header comment, point 2): the calling
  -- route is expected to run the same check before ever reaching this RPC,
  -- but this RPC is the actual write gate, so it re-checks unconditionally.
  if not validate_document_magic_bytes(p_mime_type, p_header) then
    raise exception 'invalid_file_signature: % header does not match declared mime_type %', p_original_filename, p_mime_type
      using errcode = '22023';
  end if;

  -- Same 25MB/file cap as application_documents' own CHECK constraint
  -- (20260806000006) and lib/storage/documents.ts's MAX_FILE_SIZE_BYTES --
  -- re-asserted here since this RPC is the only path that writes
  -- application_documents.byte_size after initial upload.
  if p_byte_size <= 0 or p_byte_size > 26214400 then
    raise exception 'file_too_large: % bytes exceeds the 25MB/file cap', p_byte_size
      using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next_revision
  from document_revisions
  where application_document_id = p_application_document_id;

  begin
    insert into document_revisions (
      application_document_id, revision_number, storage_path, original_filename,
      mime_type, byte_size, sha256, uploaded_by
    ) values (
      p_application_document_id, v_next_revision, p_storage_path, p_original_filename,
      p_mime_type, p_byte_size, p_sha256, auth.uid()
    );
  exception when unique_violation then
    -- The user-mandated backstop: see 20260806000024's header comment, point 1.
    raise exception 'concurrent_revision: revision_number % for application_document % was claimed by a concurrent call; retry the request', v_next_revision, p_application_document_id
      using errcode = '40001';
  end;

  update application_documents
  set storage_path = p_storage_path,
      original_filename = p_original_filename,
      mime_type = p_mime_type,
      byte_size = p_byte_size,
      sha256 = p_sha256,
      uploaded_at = now(),
      uploaded_by = auth.uid(),
      -- A new revision supersedes whatever review verdict applied to the
      -- previous revision's bytes -- product-judgment call, not a spec
      -- citation: carrying forward a review verdict about bytes that no
      -- longer exist at this document's current-revision columns would be
      -- an unverified claim (SS0.2). Resets to 'pending' so the new
      -- revision is reviewed on its own bytes.
      status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      rejection_reason = null
  where id = p_application_document_id
  returning * into v_doc;

  return v_doc;
end;
$$;
