-- Two follow-ups from the end-to-end test. Additive.
--
-- 1. Upload a hand-signed copy. Authorities that don't accept electronic
--    signatures (Richmond, ESA, ...) were emailed the unsigned filled form,
--    with no way to send a signed scan instead. An owner or permit manager
--    can now upload the signed PDF; it becomes the filing's latest generated
--    document (fill_method 'uploaded'), so it is what gets downloaded and
--    submitted. The file itself is stored by the server after the same
--    authorization check; this function records it.
-- 2. When the filled forms are generated, the permit status moves from
--    wherever it is in Intake / Requirements review / Collecting documents
--    to Internal review, recording each legal step in the history as a
--    system change. Ready to submit stays a person's decision (it is gated
--    by the readiness checklist). Generation also starts the checklist with
--    the suggested items when it is empty (an empty checklist counts as
--    complete), which needs service_role INSERT on readiness_checklist_items
--    -- the hosted project has it by default, local/CI stacks don't.

alter table generated_documents drop constraint generated_documents_fill_method_check;
alter table generated_documents
  add constraint generated_documents_fill_method_check check (fill_method in ('acroform', 'overlay', 'uploaded'));

create or replace function record_uploaded_signed_form(
  p_application_id uuid,
  p_permit_type_filing_id uuid,
  p_storage_path text,
  p_filename text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications%rowtype;
  v_document_id uuid;
  v_role org_role;
begin
  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null or not can_submit_filings(v_app.org_id) then
    raise exception 'not_authorized: only owners and permit managers can upload a signed form' using errcode = '42501';
  end if;
  if v_app.status not in ('documents_generated', 'submitted') then
    raise exception 'not_ready: generate the filled forms first';
  end if;
  if not exists (
    select 1 from permit_type_filings where id = p_permit_type_filing_id and permit_type_id = v_app.permit_type_id
  ) then
    raise exception 'invalid_filing: that filing does not belong to this application';
  end if;
  if p_storage_path is null or left(p_storage_path, 74) <> v_app.org_id::text || '/' || v_app.id::text || '/' then
    raise exception 'invalid_path: the file must be stored under this application';
  end if;
  if p_filename is distinct from p_permit_type_filing_id::text || '-signed-upload.pdf' then
    raise exception 'invalid_filename';
  end if;

  insert into generated_documents
    (application_id, permit_type_filing_id, storage_path, original_filename, fill_method, created_at)
  values
    (v_app.id, p_permit_type_filing_id, p_storage_path, p_filename, 'uploaded', clock_timestamp())
  returning id into v_document_id;

  -- A signature request would now sign an older copy; withdraw it.
  update permit_signature_requests
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where application_id = v_app.id and permit_type_filing_id = p_permit_type_filing_id and status = 'pending';

  select role into v_role from org_members where org_id = v_app.org_id and user_id = auth.uid();
  insert into audit_logs (org_id, actor_user_id, actor_role, action, entity_type, entity_id, after_summary)
  values (v_app.org_id, auth.uid(), v_role, 'generated_document.signed_copy_uploaded', 'generated_document', v_document_id,
          jsonb_build_object('permit_type_filing_id', p_permit_type_filing_id));

  return v_document_id;
end;
$$;

create or replace function advance_permit_status_after_generation(p_application_id uuid)
returns permit_status_enum
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications%rowtype;
  v_steps permit_status_enum[] := array['intake', 'requirements_review', 'collecting_documents', 'internal_review']::permit_status_enum[];
  v_from integer;
  v_i integer;
begin
  select * into v_app from permit_applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'permit_application % not found', p_application_id;
  end if;
  v_from := array_position(v_steps, v_app.permit_status);
  -- Already at Internal review or beyond (or withdrawn): leave it alone.
  if v_from is null or v_from >= array_length(v_steps, 1) then
    return v_app.permit_status;
  end if;

  for v_i in v_from .. array_length(v_steps, 1) - 1 loop
    insert into application_status_history (org_id, application_id, from_status, to_status, changed_by, reason)
    values (v_app.org_id, v_app.id, v_steps[v_i], v_steps[v_i + 1], null, 'Filled forms generated');
  end loop;

  update permit_applications set permit_status = 'internal_review' where id = v_app.id;
  return 'internal_review'::permit_status_enum;
end;
$$;

revoke all on function record_uploaded_signed_form(uuid, uuid, text, text) from public, anon;
grant execute on function record_uploaded_signed_form(uuid, uuid, text, text) to authenticated;
revoke all on function advance_permit_status_after_generation(uuid) from public, anon, authenticated;
grant execute on function advance_permit_status_after_generation(uuid) to service_role;

grant insert on readiness_checklist_items to service_role;
