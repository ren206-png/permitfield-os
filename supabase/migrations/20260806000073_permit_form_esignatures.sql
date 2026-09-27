-- E-signature, Stage B: signing the city permit form itself (flag
-- PERMITFIELD_FF_PERMIT_ESIGN). Additive only.
--
-- 1. authorities record whether they accept an electronic signature on their
--    permit form, with the official source that says so and when it was
--    checked. Signing is only offered where that is confirmed; everywhere
--    else the contractor prints and signs by hand as before.
-- 2. permit_form_signature_slots: where on each form the signature goes (a
--    box in PDF points), plus where the signer's printed name and the date go
--    -- either an AcroForm field or an overlay position on the same page.
--    Positions come from each form's own signature/date fields, or for forms
--    without fields (ESA, Richmond) from the label positions in the PDF's
--    text layer; each was checked by stamping a test signature and rendering
--    the page.
-- 3. permit_signature_requests: a request for one signer to sign one filing's
--    form, sent as a link (client-portal target token, target_kind
--    'permit_signature'). Created and cancelled only through the functions
--    below; signed only by the service role after the link was validated.
-- 4. permit_signatures: append-only evidence of each signature -- consent
--    text, method, drawn image, the fingerprint of the exact document signed,
--    and the signed document produced.

alter table authorities
  add column esignature_accepted boolean not null default false,
  add column esignature_source_url text,
  add column esignature_verified_on date,
  add constraint authorities_esignature_sourced_check check (
    not esignature_accepted
    or (esignature_source_url is not null and esignature_verified_on is not null)
  );

-- Vancouver's Development and/or Building Permit Application Form, page 3:
-- "Typing your name or inserting your signature electronically is a legal
-- written signature", above an "Applicant signature: (typed electronic,
-- inserted electronic, or written signature)" line.
update authorities set
  esignature_accepted = true,
  esignature_source_url = 'https://vancouver.ca/files/cov/dev-build-app-form.pdf',
  esignature_verified_on = '2026-09-26'
where id = '00000000-0000-0000-0002-000000000005';

-- The signing page (service role, after its link is validated) names the
-- authority the form goes to; service_role never had a read grant here
-- because only sessions read authorities until now.
grant select on authorities to service_role;

create table permit_form_signature_slots (
  id uuid primary key default gen_random_uuid(),
  permit_type_filing_id uuid not null references permit_type_filings(id) on delete cascade,
  signer_role text not null check (signer_role in ('applicant', 'owner')),
  page integer not null check (page >= 1),
  x numeric not null,
  y numeric not null,
  width numeric not null check (width > 0),
  height numeric not null check (height > 0),
  -- The form field occupying the signature box, removed when the signature
  -- is stamped so an editable field can never sit over it.
  signature_pdf_field_name text,
  name_pdf_field_name text,
  name_x numeric,
  name_y numeric,
  date_pdf_field_name text,
  date_x numeric,
  date_y numeric,
  -- The form's own date format where its date field enforces one
  -- (Acrobat AFDate_FormatEx), otherwise ISO.
  date_format text not null default 'yyyy-mm-dd' check (date_format in ('yyyy-mm-dd', 'mm/dd/yyyy', 'dd-mm-yyyy')),
  unique (permit_type_filing_id, signer_role),
  check ((name_x is null) = (name_y is null)),
  check (name_pdf_field_name is null or name_x is null),
  check ((date_x is null) = (date_y is null)),
  check (date_pdf_field_name is null or date_x is null)
);

alter table permit_form_signature_slots enable row level security;

create policy permit_form_signature_slots_select on permit_form_signature_slots
  for select to authenticated
  using (true);

revoke all on permit_form_signature_slots from anon, authenticated;
grant select on permit_form_signature_slots to authenticated;
grant select on permit_form_signature_slots to service_role;

-- Applicant signature slots for every mapped form. Only Vancouver is offered
-- today (authorities.esignature_accepted); the others are ready for when
-- their authority confirms.
insert into permit_form_signature_slots
  (permit_type_filing_id, signer_role, page, x, y, width, height,
   signature_pdf_field_name, name_pdf_field_name, name_x, name_y, date_pdf_field_name, date_x, date_y, date_format)
values
  -- Toronto: "Signature of applicant" signature field, page 2.
  ('00000000-0000-0000-0004-000000000001', 'applicant', 2, 190, 204, 322, 18,
   'Signature of applicant', 'Name of Applicant for Declaration', null, null, 'Date Applicant Signed Main Form', null, null, 'yyyy-mm-dd'),
  -- ESA: no form fields. Signature line after the "Signature" label, name
  -- after "Name" on the same line, date after the "Date" label above.
  ('00000000-0000-0000-0004-000000000002', 'applicant', 1, 368, 658.5, 94, 10,
   null, null, 261.0, 660.1, null, 137.4, 681.7, 'yyyy-mm-dd'),
  -- Surrey: "ApplicantSignature" signature field and "PrintName", page 1.
  ('00000000-0000-0000-0004-000000000004', 'applicant', 1, 80, 210, 234, 25,
   'ApplicantSignature', 'PrintName', null, null, null, null, null, 'yyyy-mm-dd'),
  -- Vancouver: the applicant signature text field and "Date", page 3.
  ('00000000-0000-0000-0004-000000000005', 'applicant', 3, 38, 72, 376, 17,
   'Applicant signature typed electronic inserted electronic or written signature', null, null, null, 'Date', null, null, 'yyyy-mm-dd'),
  -- Richmond: after "Applicant Signature:" and before "Date:", page 2.
  ('00000000-0000-0000-0004-000000000006', 'applicant', 2, 127, 79, 255, 13,
   null, null, null, null, 'SignDate_af_date', null, null, 'mm/dd/yyyy'),
  -- Coquitlam: "Signature25", "Applicant Name (Print)" and the signed date, page 3.
  ('00000000-0000-0000-0004-000000000007', 'applicant', 3, 252, 663, 144, 35,
   'Signature25', 'Applicant Name (Print)', null, null, 'Application Signed Date', null, null, 'dd-mm-yyyy'),
  -- Port Coquitlam: "Signature5", "Print Name" and "Date 1", page 4.
  ('00000000-0000-0000-0004-000000000008', 'applicant', 4, 148, 472, 132, 24,
   'Signature5', 'Print Name', null, null, 'Date 1', null, null, 'yyyy-mm-dd'),
  -- Maple Ridge: "Applicants Signature", page 1.
  ('00000000-0000-0000-0004-000000000009', 'applicant', 1, 436, 105, 121, 16,
   'Applicants Signature', null, null, null, null, null, null, 'yyyy-mm-dd')
on conflict (permit_type_filing_id, signer_role) do nothing;

create table permit_signature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references permit_applications(id) on delete cascade,
  permit_type_filing_id uuid not null references permit_type_filings(id) on delete restrict,
  signer_role text not null check (signer_role in ('applicant', 'owner')),
  signer_name text not null check (char_length(btrim(signer_name)) between 1 and 200),
  signer_email text not null check (signer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(signer_email) <= 320),
  status text not null default 'pending' check (status in ('pending', 'signed', 'cancelled')),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  signed_document_id uuid references generated_documents(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  check ((status = 'signed') = (signed_at is not null and signed_document_id is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index permit_signature_requests_one_pending
  on permit_signature_requests (application_id, permit_type_filing_id, signer_role)
  where status = 'pending';
create index permit_signature_requests_application_idx
  on permit_signature_requests (org_id, application_id, created_at desc);

alter table permit_signature_requests enable row level security;

create policy permit_signature_requests_select on permit_signature_requests
  for select to authenticated
  using (is_org_member(org_id));

-- Read-only to sessions; every write goes through the functions below.
revoke all on permit_signature_requests from anon, authenticated;
grant select on permit_signature_requests to authenticated;
revoke truncate on permit_signature_requests from service_role;
grant select, insert, update on permit_signature_requests to service_role;

create table permit_signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null unique references permit_signature_requests(id) on delete restrict,
  application_id uuid not null references permit_applications(id) on delete cascade,
  permit_type_filing_id uuid not null references permit_type_filings(id) on delete restrict,
  signer_role text not null check (signer_role in ('applicant', 'owner')),
  typed_name text not null check (char_length(btrim(typed_name)) between 1 and 200),
  esign_consent_text text not null,
  esign_consent_at timestamptz not null,
  signature_method text not null check (signature_method in ('typed', 'drawn')),
  signature_png_base64 text,
  source_document_id uuid not null references generated_documents(id) on delete restrict,
  source_document_sha256 text not null check (source_document_sha256 ~ '^[0-9a-f]{64}$'),
  signed_document_id uuid not null references generated_documents(id) on delete restrict,
  ip inet,
  user_agent text,
  external_actor_id uuid,
  external_actor_label text,
  created_at timestamptz not null default now(),
  check ((signature_method = 'drawn') = (signature_png_base64 is not null))
);

create index permit_signatures_application_idx on permit_signatures (org_id, application_id);

alter table permit_signatures enable row level security;

create policy permit_signatures_select on permit_signatures
  for select to authenticated
  using (is_org_member(org_id));

create trigger permit_signatures_append_only
  before update or delete on permit_signatures
  for each row execute function forbid_update_delete();

revoke all on permit_signatures from anon, authenticated;
grant select on permit_signatures to authenticated;
revoke update, delete, truncate on permit_signatures from service_role;
grant select, insert on permit_signatures to service_role;

-- Owner / org owner / platform admin / permit manager (can_submit_filings)
-- may ask someone to sign. Checked here rather than trusted from the caller:
-- the application is in the caller's org and has its forms generated, the
-- filing belongs to its permit type, the authority accepts electronic
-- signatures, the form has a slot for this signer, and a filled form exists.
-- A new request replaces any pending one for the same filing and signer.
create or replace function request_permit_signature(
  p_application_id uuid,
  p_permit_type_filing_id uuid,
  p_signer_role text,
  p_signer_name text,
  p_signer_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_permit_type_id uuid;
  v_request_id uuid;
begin
  select org_id, status, permit_type_id into v_org_id, v_status, v_permit_type_id
  from permit_applications where id = p_application_id;
  if v_org_id is null or not can_submit_filings(v_org_id) then
    raise exception 'not_authorized: only owners and permit managers can request signatures';
  end if;
  if v_status <> 'documents_generated' then
    raise exception 'not_ready: the filled forms must be generated, and not yet submitted';
  end if;
  if not exists (
    select 1 from permit_type_filings f
    join authorities a on a.id = f.authority_id
    where f.id = p_permit_type_filing_id
      and f.permit_type_id = v_permit_type_id
      and a.esignature_accepted
  ) then
    raise exception 'esignature_not_accepted: this authority has not confirmed it accepts electronic signatures';
  end if;
  if not exists (
    select 1 from permit_form_signature_slots
    where permit_type_filing_id = p_permit_type_filing_id and signer_role = p_signer_role
  ) then
    raise exception 'no_signature_slot: this form has no % signature', p_signer_role;
  end if;
  if not exists (
    select 1 from generated_documents
    where application_id = p_application_id and permit_type_filing_id = p_permit_type_filing_id
  ) then
    raise exception 'not_ready: no filled form has been generated for this filing';
  end if;

  update permit_signature_requests
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where application_id = p_application_id
    and permit_type_filing_id = p_permit_type_filing_id
    and signer_role = p_signer_role
    and status = 'pending';

  insert into permit_signature_requests
    (org_id, application_id, permit_type_filing_id, signer_role, signer_name, signer_email, requested_by)
  values
    (v_org_id, p_application_id, p_permit_type_filing_id, p_signer_role, btrim(p_signer_name), btrim(p_signer_email), auth.uid())
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function cancel_permit_signature_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from permit_signature_requests where id = p_request_id;
  if v_org_id is null or not can_submit_filings(v_org_id) then
    raise exception 'not_authorized: only owners and permit managers can cancel signature requests';
  end if;
  update permit_signature_requests
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'not_pending: this request has already been signed or cancelled';
  end if;
end;
$$;

-- Service role only, called after the signing link was validated. Atomic:
-- the signed document row, the evidence row and the request's status move
-- together. The document signed must still be the latest for the filing
-- (nothing regenerated or signed since the signer opened it) and the
-- application must not have been submitted.
create or replace function record_permit_signature(
  p_request_id uuid,
  p_org_id uuid,
  p_source_document_id uuid,
  p_source_document_sha256 text,
  p_signed_storage_path text,
  p_signed_filename text,
  p_typed_name text,
  p_esign_consent_text text,
  p_signature_method text,
  p_signature_png_base64 text,
  p_ip inet default null,
  p_user_agent text default null,
  p_external_actor_id uuid default null,
  p_external_actor_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request permit_signature_requests%rowtype;
  v_latest_document_id uuid;
  v_source generated_documents%rowtype;
  v_signed_document_id uuid;
begin
  select * into v_request from permit_signature_requests
  where id = p_request_id and org_id = p_org_id
  for update;
  if v_request.id is null then
    raise exception 'request_not_found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'not_pending: this request has already been signed or cancelled';
  end if;
  if not exists (
    select 1 from permit_applications
    where id = v_request.application_id and org_id = p_org_id and status = 'documents_generated'
  ) then
    raise exception 'not_ready: this application is no longer open for signing';
  end if;

  select id into v_latest_document_id from generated_documents
  where application_id = v_request.application_id and permit_type_filing_id = v_request.permit_type_filing_id
  order by created_at desc, id desc
  limit 1;
  if v_latest_document_id is distinct from p_source_document_id then
    raise exception 'stale_document: the form changed after it was opened';
  end if;

  if p_typed_name is null or btrim(p_typed_name) = '' then
    raise exception 'typed_name_required';
  end if;
  perform assert_valid_esignature(p_esign_consent_text, p_signature_method, p_signature_png_base64);

  select * into v_source from generated_documents where id = p_source_document_id;

  -- clock_timestamp(), not now(): the signed copy must sort after the
  -- document it was made from even if both were written in one transaction.
  insert into generated_documents
    (application_id, permit_type_filing_id, storage_path, original_filename, fill_method,
     incomplete_required_fields, incomplete_optional_fields, created_at)
  values
    (v_source.application_id, v_source.permit_type_filing_id, p_signed_storage_path, p_signed_filename, v_source.fill_method,
     v_source.incomplete_required_fields, v_source.incomplete_optional_fields, clock_timestamp())
  returning id into v_signed_document_id;

  insert into permit_signatures
    (org_id, request_id, application_id, permit_type_filing_id, signer_role, typed_name,
     esign_consent_text, esign_consent_at, signature_method, signature_png_base64,
     source_document_id, source_document_sha256, signed_document_id,
     ip, user_agent, external_actor_id, external_actor_label)
  values
    (p_org_id, v_request.id, v_request.application_id, v_request.permit_type_filing_id, v_request.signer_role, btrim(p_typed_name),
     p_esign_consent_text, now(), p_signature_method, p_signature_png_base64,
     p_source_document_id, p_source_document_sha256, v_signed_document_id,
     p_ip, p_user_agent, p_external_actor_id, p_external_actor_label);

  update permit_signature_requests
  set status = 'signed', signed_at = now(), signed_document_id = v_signed_document_id
  where id = v_request.id;

  return v_signed_document_id;
end;
$$;

-- Platform defaults grant EXECUTE on new functions to anon and
-- authenticated directly (see 20260806000071); revoke them by name.
revoke all on function request_permit_signature(uuid, uuid, text, text, text) from public, anon;
grant execute on function request_permit_signature(uuid, uuid, text, text, text) to authenticated;
revoke all on function cancel_permit_signature_request(uuid) from public, anon;
grant execute on function cancel_permit_signature_request(uuid) to authenticated;
revoke all on function record_permit_signature(uuid, uuid, uuid, text, text, text, text, text, text, text, inet, text, uuid, text)
  from public, anon, authenticated;
grant execute on function record_permit_signature(uuid, uuid, uuid, text, text, text, text, text, text, text, inet, text, uuid, text)
  to service_role;
