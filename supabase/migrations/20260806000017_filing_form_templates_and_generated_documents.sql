-- Phase 4 design gap, found by reading seed.sql before writing any PDF-fill
-- code (not theoretical): permit_form_fields / permit_types.required_form_
-- template_path (20260806000005) are scoped to permit_type_id only. But
-- permit_type_filings already models "one permit_type, N authorities, filed
-- separately" (e.g. seed's Electrical Service Upgrade permit_type fans out to
-- a Toronto Building filing AND a separate ESA filing), and those two filings
-- need physically different PDF forms with different field maps -- Toronto's
-- is a real 71-field AcroForm, ESA's ICIA Low Voltage form is a flattened
-- export with zero AcroForm fields (Phase 0 finding, PHASE_0_FINDINGS.md).
-- A single permit_type-scoped template path / field map cannot represent
-- that. This migration re-scopes both to the filing, additively: the old
-- permit_type_id-scoped columns/rows are left in place untouched (additive-
-- only global rule), the new filing-scoped columns are what Phase 4's
-- application code (lib/pdf/*, lib/inngest/functions/generate-pdf.ts) will
-- actually read from.

alter table permit_type_filings add column form_template_path text;

alter table permit_form_fields add column permit_type_filing_id uuid references permit_type_filings(id) on delete cascade;

-- NOT NULL is safe to add directly here (no backfill step needed): this
-- table is empty at the moment this ALTER runs during `supabase db reset`
-- (migrations always run against a freshly-recreated schema, before
-- seed.sql inserts any rows -- confirmed by inspecting the reset order in
-- supabase/config.toml and by every prior migration in this repo following
-- the same assumption, e.g. 20260806000012's enum addition). Going forward,
-- every field-map row must be scoped to a specific filing -- the ambiguity
-- that motivated this migration in the first place -- so this is enforced at
-- the database layer, not left as an application-level convention that could
-- silently be forgotten.
alter table permit_form_fields alter column permit_type_filing_id set not null;

create index permit_form_fields_permit_type_filing_id_idx on permit_form_fields (permit_type_filing_id);

-- Filled PDFs are their own append-only record, mirroring audits/extractions:
-- every generation attempt is recorded, never overwritten, so a contractor
-- (or this team, debugging a support ticket) can see exactly which fields a
-- given generated PDF left blank and why, rather than having to reopen the
-- PDF and manually diff it against the source data.
--
-- incomplete_required_fields / incomplete_optional_fields are jsonb arrays of
-- maps_to paths (e.g. '["applicant.lastName"]") -- populated when
-- lib/pdf/resolve-fields.ts leaves a field blank because the underlying
-- extracted value was missing or below PDF_FILL_MIN_CONFIDENCE (SS1: no
-- unverified AI-extracted value gets typed onto a legal government form).
-- Required vs. optional is split into two columns (not one array with a
-- severity field) so a caller can cheaply check "is this PDF actually usable"
-- via `incomplete_required_fields = '[]'` without parsing structure out of a
-- mixed array.
create table generated_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references permit_applications(id) on delete cascade,
  permit_type_filing_id uuid not null references permit_type_filings(id) on delete restrict,
  storage_path text not null,
  original_filename text not null,
  fill_method text not null check (fill_method in ('acroform', 'overlay')),
  incomplete_required_fields jsonb not null default '[]'::jsonb,
  incomplete_optional_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index generated_documents_application_id_idx on generated_documents (application_id);
create index generated_documents_permit_type_filing_id_idx on generated_documents (permit_type_filing_id);

alter table generated_documents enable row level security;

-- Same shape as audits_select (20260806000009): join through
-- permit_applications for org scoping, select-only for authenticated --
-- these rows are produced by the service-role worker (lib/inngest/functions/
-- generate-pdf.ts), never written directly by a contractor's own session.
create policy generated_documents_select on generated_documents
  for select to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = generated_documents.application_id
        and is_org_member(pa.org_id)
    )
  );

create trigger generated_documents_append_only
  before update or delete on generated_documents
  for each row execute function forbid_update_delete();

-- Asymmetric grant, same pattern and same reasoning as audits/audit_findings
-- (20260806000011's header comment): broad grant to authenticated so the
-- actual denial for insert/update/delete comes from RLS (no insert policy
-- exists for authenticated) and the trigger above, not a generic table-level
-- permission-denied error that would leak which layer is enforcing it.
grant select, insert, update, delete on generated_documents to authenticated;

-- service_role grants, issued proactively in this same migration (the Phase
-- 3 adversarial self-check found that 20260806000011 shipped without ANY
-- service_role grants at all, breaking every background job silently -- see
-- 20260806000015's header for the full story; that lesson is applied here
-- from the start instead of being rediscovered after the fact). Scoped to
-- exactly what lib/inngest/functions/generate-pdf.ts will read/write:
-- permit_type_filings/permit_form_fields (the new filing-scoped template
-- path and field map), contractors (structured, human-entered applicant
-- data used alongside AI-extracted data when resolving a field's value),
-- and generated_documents itself (insert, plus select for the `.select()`
-- that follows `.insert()` in this codebase's established Supabase client
-- pattern, per 20260806000015's own comment on why SELECT accompanies
-- INSERT wherever RETURNING is used).
grant select on permit_type_filings to service_role;
grant select on permit_form_fields to service_role;
grant select on contractors to service_role;
grant select, insert on generated_documents to service_role;

-- New private Storage bucket for the blank government PDF templates
-- themselves (docs-reference-forms/ locally; this bucket is where they live
-- at runtime for the Inngest worker to read by permit_type_filings.
-- form_template_path). No RLS policy for authenticated/anon is created here
-- -- deliberately -- contractors never need direct access to a blank
-- template, only to their own filled-in PDF (permitfield-generated, already
-- policied in 20260806000013). storage.objects/storage.buckets already carry
-- full service_role privileges by Supabase's own platform default (verified
-- empirically during Phase 4 research via information_schema.role_table_
-- grants, same check that surfaced the public-schema service_role gap above)
-- -- so default-deny for every other role is sufficient and no extra GRANT is
-- needed for this bucket to work.
insert into storage.buckets (id, name, public, file_size_limit)
values ('permitfield-form-templates', 'permitfield-form-templates', false, 26214400)
on conflict (id) do nothing;
