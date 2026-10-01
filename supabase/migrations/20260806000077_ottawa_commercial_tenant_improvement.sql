-- Ottawa, ON: Commercial Tenant Improvement on Ontario's provincial form.
--
-- Ottawa has no city-specific application form: its Building permits FAQ
-- (ottawa.ca, checked 2026-09-30) says "You may download a copy of the form
-- from the Ontario Ministry of Municipal Affairs and Housing's web page".
-- That form is the "Application for a Permit to Construct or Demolish",
-- which municipalities must use from February 16, 2026 (Ontario CodeNews
-- Issue 377). The file stored at ontario/permit-to-construct-or-demolish-2026.pdf
-- is ontario.ca's 2026-01-27 version (4 pages, 133 AcroForm fields), the
-- same field names Toronto's form uses -- so the applicant signature, printed
-- name and signing date use the same slot as Toronto's.
--
-- Submission: Ottawa's preferred route is its Building, Planning and Land
-- Development portal in My ServiceOttawa (account required, payment with
-- the application); in-person by appointment at Building Code Services
-- counters. Ottawa's own Building By-law is No. 2014-220. Electrical work
-- goes to ESA separately (same FAQ), as in Toronto.
--
-- Field map: only fields the application reliably knows -- project address
-- (street line, city, postal code), value, area, description, the applicant
-- (name, email, company) and the builder's company. Owner, designer, sewage
-- installer, checkboxes and the declarations are left for the contractor.

insert into authorities (id, name, authority_level, province_code, jurisdiction_id, portal_url, filing_mechanism,
                         submission_instructions, office_address)
values
  ('00000000-0000-0000-0002-00000000000a', 'City of Ottawa - Building Code Services', 'municipal', 'ON',
   '00000000-0000-0000-0001-000000000003',
   'https://myservice.ottawa.ca/',
   'portal',
   'Apply through the Building, Planning and Land Development portal in My ServiceOttawa (a MySO account is required); payment must accompany the application. In person: Building Code Services counters by appointment, e.g. Ben Franklin Place, 101 Centrepointe Drive.',
   'Ben Franklin Place, 101 Centrepointe Drive, Ottawa, ON K2G 5K7')
on conflict (id) do nothing;

insert into permit_types (id, jurisdiction_id, title, required_form_template_path, compliance_rules, version, verified_at, verified_by)
values
  ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0001-000000000003',
   'Commercial Tenant Improvement', 'ontario/permit-to-construct-or-demolish-2026.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'cities-2026-09-30')
on conflict (id) do nothing;

insert into permit_type_filings (id, permit_type_id, authority_id, sequence, is_conditional_on, form_template_path)
values
  ('00000000-0000-0000-0004-00000000000a', '00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0002-00000000000a', 1, null,
   'ontario/permit-to-construct-or-demolish-2026.pdf')
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from permit_form_fields where permit_type_filing_id = '00000000-0000-0000-0004-00000000000a') then
    insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
    values
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Project building number street name', 'application.addressStreetLine', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Project Municipality', 'application.addressCity', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Project postal code', 'application.addressPostalCode', false, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Project value estimated (in dollars)', 'application.estimatedJobValueDollars', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Project area of work (in square metres)', 'application.squareFootage', false, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Description of proposed work', 'application.projectDescription', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Applicant last name', 'applicant.lastName', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Applicant First name', 'applicant.firstName', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Applicant Corporation or partnership', 'contractor.companyName', false, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Applicant Email', 'applicant.email', true, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Builder Corporation or partnership (if applicable)', 'contractor.companyName', false, null, null, null),
      -- ontario.ca's blank form ships with "ADE" typed into these two Owner
      -- fields; clear them so it never reaches an application.
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Owner Unit number', 'form.clear', false, null, null, null),
      ('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0004-00000000000a', 'Owner Lot/Concession', 'form.clear', false, null, null, null);
  end if;
end $$;

insert into permit_form_signature_slots
  (permit_type_filing_id, signer_role, page, x, y, width, height,
   signature_pdf_field_name, name_pdf_field_name, name_x, name_y, date_pdf_field_name, date_x, date_y, date_format)
values
  ('00000000-0000-0000-0004-00000000000a', 'applicant', 2, 190, 204, 322, 18,
   'Signature of applicant', 'Name of Applicant for Declaration', null, null, 'Date Applicant Signed Main Form', null, null, 'yyyy-mm-dd')
on conflict (permit_type_filing_id, signer_role) do nothing;
