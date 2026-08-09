-- Lifecycle & Compliance Expansion, Gate 1.4: "Document lifecycle -- storage,
-- versioning, review" (flag PERMITFIELD_FF_DOCUMENTS). Additive only against
-- every prior migration: no existing column, row, or enum value on
-- application_documents is renamed, retyped, or removed.
--
-- Architecture citation: PHASE_0_FINDINGS.md SS M (the Gate 1.4 pre-branch
-- addendum, agreed with the user before this branch existed):
--   M.1 -- extend application_documents, do not build a parallel documents
--         table. docs/PERMISSIONS.md's own Table 2 already keys several
--         roles' grants (e.g. document_reviewer: C,R,A) against the literal
--         `application_documents` resource -- this migration is what makes
--         that pre-existing target model real.
--   M.2 -- reuse the existing permitfield-uploads bucket and its 25MB/file
--         cap; no per-org/month cap in this gate (deferred to a future
--         billing/entitlements gate, explicit user decision -- no
--         entitlement key is invented here to gate a feature not being
--         built); no automatic retention/expiry (archival-only, SS3.1);
--         versioning is mandatory (SS3.6).
--   M.3 -- documents are archived, never hard-deleted, by roles already
--         holding 'archive' in lib/authz/index.ts's target matrix -- this
--         closes the exact gap docs/PERMISSIONS.md:125-129 flagged
--         ("application_documents DELETE is not owner-restricted... any org
--         member can delete any document in their org today"). audit_logs
--         captures upload/review events, never download (SS3.6) -- download
--         audit-logging is explicitly out of scope, same as it is for the
--         download route itself (a later, application-layer task).
--
-- Revision model (agreed with the user this gate): application_documents
-- keeps every existing column and always denormalizes the CURRENT
-- revision's storage_path/original_filename/mime_type/byte_size/sha256/
-- uploaded_at -- so lib/inngest/functions/{extract,audit}.ts, which already
-- read exactly those columns, need zero changes. document_revisions is a
-- new append-only child table holding full history. The ONLY sanctioned
-- mutation paths for either table after initial upload are the two
-- SECURITY DEFINER functions below (replace_application_document(),
-- archive_application_document()) -- never a raw client UPDATE. This
-- mirrors transition_permit_status()'s shape exactly (20260806000022):
-- explicit org-membership + role checks as the function's first statements
-- (SECURITY DEFINER bypasses RLS entirely, so the function has to do its
-- own authorization), optimistic locking via `for update`, and a
-- column-level grant lockout at the bottom of this file so no other write
-- path exists for `authenticated` at all.
--
-- Two explicit user-mandated constraints for this migration:
--   1. document_revisions.revision_number gets a REAL unique(
--      application_document_id, revision_number) database constraint, not
--      just the application-level "increment and insert" logic in
--      replace_application_document() below -- so a mid-transaction failure
--      followed by a retry becomes a hard unique_violation error instead of
--      a silent numbering gap. (The `for update` row lock on
--      application_documents in that function is what prevents this from
--      happening under ordinary concurrent calls; the constraint is the
--      backstop for anything the lock doesn't cover.)
--   2. Magic-byte MIME validation is re-checked INSIDE
--      replace_application_document() itself (validate_document_magic_bytes
--      below), not only in the calling route -- defense in depth, since the
--      RPC, not the route, is the actual write gate.
--
-- What this migration deliberately does NOT add (flagged, not silently
-- decided): a review_application_document()-style RPC for the new
-- status/reviewed_by/reviewed_at/rejection_reason columns. Those columns
-- ship now per SS3.6's field list ("schema exists, zero call sites yet" --
-- the same pattern permit_status shipped under in Gate 1.3, 20260806000022
-- L43-45), but this pass was scoped to exactly the two RPCs the user named
-- (replace + archive). A third RPC is a natural follow-up, but who is
-- allowed to review a document is genuinely ambiguous in the CURRENT
-- lib/authz/index.ts matrix as written (document_reviewer has
-- ['create','read','archive'] on application_documents -- no 'update' --
-- despite being the role literally named for reviewing), and resolving
-- that ambiguity is a product decision for the user, not something this
-- migration should guess at.

create type document_review_status as enum ('pending', 'approved', 'rejected');

-- All seven new columns are nullable or defaulted -- additive-only, and
-- safe against supabase/seed.sql's existing permit_applications fixture
-- rows (seed.sql has zero application_documents rows today, confirmed via
-- direct read) and supabase/tests/tenant_isolation.test.sql's inline
-- application_documents fixture insert (which does not list these columns
-- and will pick up the defaults unchanged).
alter table application_documents
  add column status document_review_status not null default 'pending',
  -- default auth.uid(): populates itself on every future insert through the
  -- existing app/api/documents/route.ts upload path with zero route code
  -- change required by this migration. Existing rows get NULL (auth.uid()
  -- has no request context to evaluate against during the migration itself)
  -- -- acceptable, same "additive column, no backfill claim for pre-existing
  -- rows" shape as permit_applications.project_id in 20260806000022.
  add column uploaded_by uuid references auth.users(id) default auth.uid(),
  add column reviewed_by uuid references auth.users(id),
  add column reviewed_at timestamptz,
  add column rejection_reason text,
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id);

alter table application_documents
  add constraint application_documents_reviewed_pair
    check ((reviewed_by is null) = (reviewed_at is null)),
  add constraint application_documents_rejection_reason_requires_rejected
    check (rejection_reason is null or status = 'rejected'),
  add constraint application_documents_archived_pair
    check ((archived_at is null) = (archived_by is null));

-- document_revisions: full history, one row per revision, immutable once
-- written. No org_id column of its own -- same shape as application_documents
-- itself (20260806000006's own note: it has no org_id, tenancy resolves by
-- joining through permit_applications), so this table resolves tenancy by
-- joining through application_documents -> permit_applications, two hops
-- instead of one.
create table document_revisions (
  id uuid primary key default gen_random_uuid(),
  application_document_id uuid not null references application_documents(id) on delete cascade,
  revision_number int not null check (revision_number > 0),
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  sha256 char(64) not null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  -- The user-mandated hard constraint: see this file's header comment,
  -- point 1.
  unique (application_document_id, revision_number)
);

create index document_revisions_application_document_id_idx
  on document_revisions (application_document_id);

alter table document_revisions enable row level security;

create policy document_revisions_select on document_revisions
  for select to authenticated
  using (
    exists (
      select 1
      from application_documents ad
      join permit_applications pa on pa.id = ad.application_id
      where ad.id = document_revisions.application_document_id
        and is_org_member(pa.org_id)
    )
  );

-- Append-only, same forbid_update_delete() reuse as application_status_history
-- (20260806000022) and audits (20260806000009) -- belt-and-suspenders
-- alongside "no INSERT/UPDATE/DELETE grant to `authenticated` at all" below.
create trigger document_revisions_append_only
  before update or delete on document_revisions
  for each row execute function forbid_update_delete();

-- Seeds revision 1 the moment a document is first uploaded via the existing
-- application_documents_insert RLS policy (app/api/documents/route.ts,
-- unchanged by this migration) -- so document_revisions is authoritative
-- history from the very first byte, not just from the first replacement
-- onward. Direct precedent: seed_permit_status_history() (20260806000022),
-- same "AFTER INSERT trigger on the parent seeds the child ledger's first
-- row" shape. SECURITY DEFINER because document_revisions has no INSERT
-- grant for `authenticated` at all (see the grants section below) -- this
-- trigger and replace_application_document() are its only two writers.
create or replace function seed_document_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into document_revisions (
    application_document_id, revision_number, storage_path, original_filename,
    mime_type, byte_size, sha256, uploaded_by
  ) values (
    new.id, 1, new.storage_path, new.original_filename,
    new.mime_type, new.byte_size, new.sha256, coalesce(new.uploaded_by, auth.uid())
  );
  return new;
end;
$$;

create trigger application_documents_seed_revision
  after insert on application_documents
  for each row execute function seed_document_revision();

-- Magic-byte validation: checks the FIRST BYTES OF THE ACTUAL FILE against
-- known signatures for the four MIME types lib/storage/documents.ts's
-- ALLOWED_MIME_TYPES allowlist already permits (application/pdf, image/jpeg,
-- image/png, image/tiff) -- a real gap that allowlist alone did not close,
-- since it only ever compared against the browser-reported File.type, which
-- a client fully controls. Fails closed on any mime_type outside those four,
-- same allowlist shape as the existing constant.
create or replace function validate_document_magic_bytes(p_mime_type text, p_header bytea)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_header is null then
    return false;
  end if;

  if p_mime_type = 'application/pdf' then
    return length(p_header) >= 4 and substring(p_header from 1 for 4) = '\x25504446'::bytea;
  elsif p_mime_type = 'image/jpeg' then
    return length(p_header) >= 3 and substring(p_header from 1 for 3) = '\xffd8ff'::bytea;
  elsif p_mime_type = 'image/png' then
    return length(p_header) >= 8 and substring(p_header from 1 for 8) = '\x89504e470d0a1a0a'::bytea;
  elsif p_mime_type = 'image/tiff' then
    return length(p_header) >= 4
      and substring(p_header from 1 for 4) in ('\x49492a00'::bytea, '\x4d4d002a'::bytea);
  else
    return false;
  end if;
end;
$$;

grant execute on function validate_document_magic_bytes(text, bytea) to authenticated, service_role;

-- Sanctioned write path for every application_documents revision after the
-- initial upload. SECURITY DEFINER, same self-authorizing shape as
-- transition_permit_status() -- does its own org-membership and role checks
-- as its first statements, since SECURITY DEFINER bypasses
-- application_documents' RLS entirely.
--
-- p_header: caller-supplied prefix of the new file's actual bytes (the
-- calling route reads this from the uploaded file server-side, the same way
-- it already computes the file's sha256 -- not from any client-asserted
-- value). See this file's header comment, point 2, for why this check lives
-- here and not only in the route.
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
  -- doesn't cover, per this file's header comment.
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

  -- Defense in depth (this file's header comment, point 2): the calling
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
    -- The user-mandated backstop: see this file's header comment, point 1.
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

revoke all on function replace_application_document(uuid, text, text, text, bigint, char(64), bytea) from public;
grant execute on function replace_application_document(uuid, text, text, text, bigint, char(64), bytea) to authenticated;

-- Sanctioned archival path -- replaces the raw application_documents_delete
-- RLS policy (dropped below), closing the pre-existing gap
-- docs/PERMISSIONS.md:125-129 flagged: "any org member can delete any
-- document in their org today". SECURITY DEFINER, same self-authorizing
-- shape as replace_application_document() above.
create or replace function archive_application_document(p_application_document_id uuid)
returns application_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc application_documents;
  v_org_id uuid;
  v_role org_role;
begin
  select * into v_doc from application_documents where id = p_application_document_id for update;
  if v_doc.id is null then
    raise exception 'application_document % not found', p_application_document_id;
  end if;

  select pa.org_id into v_org_id from permit_applications pa where pa.id = v_doc.application_id;
  if v_org_id is null or not is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Role check mirrors lib/authz/index.ts's matrix: only roles holding
  -- 'archive' against application_documents. NOT the same list as
  -- replace_application_document() above -- permit_coordinator has
  -- 'update' but not 'archive' in that matrix, so it is deliberately
  -- excluded here (auditor_readonly/client_user are excluded from both
  -- lists, since neither has any application_documents entry at all).
  select role into v_role from org_members where org_id = v_org_id and user_id = auth.uid();
  if v_role not in (
    'owner', 'org_owner', 'platform_admin', 'member',
    'permit_manager', 'document_reviewer', 'applicant_contractor'
  ) then
    raise exception 'insufficient_privilege: role % may not archive this document', v_role
      using errcode = '42501';
  end if;

  -- Idempotent: archiving an already-archived document is a silent no-op
  -- returning the current (already-archived) row, rather than an error --
  -- same "retry doesn't error" ethos as transition_permit_status()'s
  -- request_key handling, without needing a request_key here since there is
  -- no "which archival" ambiguity for this action to disambiguate.
  update application_documents
  set archived_at = now(), archived_by = auth.uid()
  where id = p_application_document_id
    and archived_at is null
  returning * into v_doc;

  if v_doc.id is null then
    select * into v_doc from application_documents where id = p_application_document_id;
  end if;

  return v_doc;
end;
$$;

revoke all on function archive_application_document(uuid) from public;
grant execute on function archive_application_document(uuid) to authenticated;

-- Close the pre-existing gap: hard delete is no longer a sanctioned path
-- for application_documents at all -- archive_application_document() above
-- is the only way to retire a document now. Drops the raw, non-owner-
-- restricted DELETE policy from 20260806000006 and revokes the table-level
-- DELETE grant from 20260806000011, so a direct `delete from
-- application_documents` fails at the grant layer (insufficient_privilege,
-- 42501) before RLS is ever evaluated -- same "REVOKE closes it at a layer
-- RLS can't" reasoning as transition_permit_status()'s column-level lockout
-- (20260806000022).
drop policy if exists application_documents_delete on application_documents;
revoke delete on application_documents from authenticated;

-- document_revisions: SELECT only for `authenticated` -- its two writers
-- (seed_document_revision()'s trigger, replace_application_document()) are
-- both SECURITY DEFINER and write as the function owner, so neither needs
-- (and neither is granted) any table-level write privilege. Same
-- "RLS default-deny + no grant at all" shape as application_status_history
-- (20260806000022).
grant select on document_revisions to authenticated;

-- service_role: unaffected by this migration. It keeps its existing
-- `select, update on application_documents` grant (20260806000015) --
-- lib/inngest/functions/extract.ts's text_layer_chars write and
-- lib/inngest/functions/audit.ts's doc_kind read both continue to work
-- unchanged, since neither the columns they touch nor that grant were
-- altered here. service_role has no document_revisions grant -- no
-- background job in this gate touches that table.
