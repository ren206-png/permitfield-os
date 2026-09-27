-- Submit to authority (flag PERMITFIELD_FF_CITY_SUBMISSION). Additive only.
--
-- 1. authorities gain a verified intake email (with the official page it was
--    read from and when), filing instructions shown to the contractor before
--    they submit, and an office address for in-person filers. Only addresses
--    read directly from the authority's own published material are recorded;
--    an authority with no verified address cannot be emailed by the app.
-- 2. filing_submissions: an append-only record of every submission of one
--    filing to its authority -- an email the app sent (or failed to send), or
--    a portal/in-person filing the contractor recorded themselves.

alter table authorities
  add column submission_email text check (submission_email is null or submission_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column submission_email_source_url text,
  add column submission_email_verified_on date,
  add column submission_instructions text,
  add column office_address text,
  add constraint authorities_submission_email_sourced_check check (
    submission_email is null
    or (submission_email_source_url is not null and submission_email_verified_on is not null)
  );

-- Richmond: PL-59 "Electronic Building Permit Application - Quick Start
-- Guide" (rev. Mar 10, 2026), step 1: email the completed application form to
-- BuildingApplications@richmond.ca titled "<Property Address>, <Building
-- Permit Type>", with a file-sharing link to all drawings/documents as PDFs.
update authorities set
  submission_email = 'BuildingApplications@richmond.ca',
  submission_email_source_url = 'https://www.richmond.ca/__shared/assets/ElectronicBldgPermitApplQuickGuide57238.pdf',
  submission_email_verified_on = '2026-09-26',
  submission_instructions = 'Richmond checks the application for completeness first, then sends a fee letter; application fees are paid by mail or verified courier, not by email. Drawings must be PDFs named "<Project Address> <Document Type>", and sealed drawings need both a professional seal and a digital signature -- scanned wet seals are not accepted.'
where id = '00000000-0000-0000-0002-000000000006';

-- ESA: esasafe.com/fees-and-forms/forms/, "Submit a New Notification/Permit":
-- completed forms go to esa.cambridge@electricalsafety.on.ca, and "Payment is
-- required at the time the notification is submitted" -- credit card by
-- phone through ESA Customer Service.
update authorities set
  submission_email = 'esa.cambridge@electricalsafety.on.ca',
  submission_email_source_url = 'https://esasafe.com/fees-and-forms/forms/',
  submission_email_verified_on = '2026-09-26',
  submission_instructions = 'ESA requires payment when the notification is submitted. After sending, call ESA Customer Service at 1-877-372-7233 to pay by credit card. Never put card details in the email.'
where id = '00000000-0000-0000-0002-000000000002';

-- Roles that may submit on the org's behalf: the "submission" tier
-- transition_permit_status() already uses for the submitted status
-- (20260806000061). plpgsql because it references org_role values added by a
-- later ALTER TYPE (same reason as can_read_audit_logs()).
create or replace function can_submit_filings(check_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner', 'platform_admin', 'permit_manager')
  );
end;
$$;

revoke all on function can_submit_filings(uuid) from public;
grant execute on function can_submit_filings(uuid) to authenticated;

create table filing_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references permit_applications(id) on delete cascade,
  permit_type_filing_id uuid not null references permit_type_filings(id) on delete restrict,
  authority_id uuid not null references authorities(id) on delete restrict,
  method text not null check (method in ('email', 'portal', 'in_person')),
  status text not null check (status in ('sent', 'failed', 'recorded')),
  to_email text,
  cc_email text,
  subject text,
  generated_document_id uuid references generated_documents(id) on delete restrict,
  document_links_expire_at timestamptz,
  provider_message_id text,
  error_message text,
  external_reference text check (external_reference is null or char_length(external_reference) <= 200),
  submitted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((method = 'email') = (status in ('sent', 'failed'))),
  check ((method = 'email') = (to_email is not null)),
  check (status <> 'failed' or error_message is not null)
);

create index filing_submissions_application_idx on filing_submissions (org_id, application_id, created_at desc);

alter table filing_submissions enable row level security;

create policy filing_submissions_select on filing_submissions
  for select to authenticated
  using (is_org_member(org_id));

create policy filing_submissions_insert on filing_submissions
  for insert to authenticated
  with check (can_submit_filings(org_id) and submitted_by = auth.uid());

create trigger filing_submissions_append_only
  before update or delete on filing_submissions
  for each row execute function forbid_update_delete();

-- Explicit grants (platform defaults grant everything; see
-- SERVICE_ROLE_GRANTS_FINDINGS.md). TRUNCATE bypasses the row trigger.
revoke all on filing_submissions from anon, authenticated;
grant select, insert on filing_submissions to authenticated;
revoke update, delete, truncate on filing_submissions from service_role;
grant select, insert on filing_submissions to service_role;
