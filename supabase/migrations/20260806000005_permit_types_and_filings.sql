-- 3.5 / 3.4b / 3.7. permit_types are hand-curated and dated, never model-generated
-- (compliance_rules is checked in application code, not by the AI -- see SS4.3).
-- permit_type_filings expresses "one permit type, N authorities, ordered" so the
-- wizard can emit more than one application package per project (SS0.6).

create table permit_types (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  title text not null,
  required_form_template_path text,
  compliance_rules jsonb not null default '{}'::jsonb,
  version int not null default 1,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table permit_type_filings (
  id uuid primary key default gen_random_uuid(),
  permit_type_id uuid not null references permit_types(id) on delete cascade,
  authority_id uuid not null references authorities(id) on delete restrict,
  sequence int not null,
  is_conditional_on jsonb,
  created_at timestamptz not null default now(),
  unique (permit_type_id, sequence)
);

-- Field mapping cannot be hardcoded in a route handler -- it varies per
-- jurisdiction form (SS3.7). overlay_page/x/y are only populated for flat
-- (non-AcroForm) templates; Phase 0 found the ESA notification forms are
-- exactly this case -- pdf_field_name will be null for those rows.
create table permit_form_fields (
  id uuid primary key default gen_random_uuid(),
  permit_type_id uuid not null references permit_types(id) on delete cascade,
  pdf_field_name text,
  maps_to text not null,
  transform text,
  is_required boolean not null default false,
  overlay_page int,
  overlay_x numeric,
  overlay_y numeric,
  created_at timestamptz not null default now(),
  check (
    (pdf_field_name is not null and overlay_page is null and overlay_x is null and overlay_y is null)
    or
    (pdf_field_name is null and overlay_page is not null and overlay_x is not null and overlay_y is not null)
  )
);

create index permit_type_filings_permit_type_id_idx on permit_type_filings (permit_type_id);
create index permit_type_filings_authority_id_idx on permit_type_filings (authority_id);
create index permit_form_fields_permit_type_id_idx on permit_form_fields (permit_type_id);

alter table permit_types enable row level security;
alter table permit_type_filings enable row level security;
alter table permit_form_fields enable row level security;

-- Reference data, same pattern as jurisdictions/authorities: read-only for
-- authenticated users, writes are service-role (curation pipeline / admin) only.
create policy permit_types_select on permit_types
  for select to authenticated
  using (true);

create policy permit_type_filings_select on permit_type_filings
  for select to authenticated
  using (true);

create policy permit_form_fields_select on permit_form_fields
  for select to authenticated
  using (true);
