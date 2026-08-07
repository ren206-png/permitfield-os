-- 3.6 / 3.8. The status enum includes the failure states the original draft
-- omitted (extraction_failed, audit_failed) -- a status enum with no failure
-- path guarantees stuck rows once a background job errors out.

create type application_status as enum (
  'draft',
  'uploading',
  'extracting',
  'extraction_failed',
  'auditing',
  'audit_failed',
  'ready_for_review',
  'reviewed',
  'submitted'
);

create table permit_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete restrict,
  permit_type_id uuid not null references permit_types(id) on delete restrict,
  project_title text not null,
  project_address text not null,
  status application_status not null default 'draft',
  -- Money is integer minor units PLUS a currency code (global engineering rule) --
  -- a bare *_cents column is a bug the day US pricing lands (SS0.8).
  estimated_job_value_cents bigint check (estimated_job_value_cents >= 0),
  currency_code char(3) not null default 'CAD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type doc_kind as enum ('blueprint', 'spec_sheet', 'scope_of_work', 'other');

create table application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references permit_applications(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  -- 25 MB/file cap (SS4.1) enforced again here as defense-in-depth alongside the
  -- Storage bucket policy and upload-route validation.
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  sha256 char(64) not null,
  doc_kind doc_kind not null default 'other',
  text_layer_chars int,
  uploaded_at timestamptz not null default now(),
  unique (application_id, sha256)
);

create index permit_applications_org_id_idx on permit_applications (org_id);
create index permit_applications_contractor_id_idx on permit_applications (contractor_id);
create index application_documents_application_id_idx on application_documents (application_id);

alter table permit_applications enable row level security;
alter table application_documents enable row level security;

create policy permit_applications_select on permit_applications
  for select to authenticated
  using (is_org_member(org_id));

create policy permit_applications_insert on permit_applications
  for insert to authenticated
  with check (is_org_member(org_id));

create policy permit_applications_update on permit_applications
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy permit_applications_delete on permit_applications
  for delete to authenticated
  using (is_org_owner(org_id));

-- application_documents has no org_id column of its own; membership is
-- resolved through its parent application.
create policy application_documents_select on application_documents
  for select to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = application_documents.application_id
        and is_org_member(pa.org_id)
    )
  );

create policy application_documents_insert on application_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from permit_applications pa
      where pa.id = application_documents.application_id
        and is_org_member(pa.org_id)
    )
  );

create policy application_documents_delete on application_documents
  for delete to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = application_documents.application_id
        and is_org_member(pa.org_id)
    )
  );
