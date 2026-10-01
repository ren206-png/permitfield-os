-- Edmonton, AB: Commercial Tenant Improvement on Edmonton's Short-Form.
--
-- Form: "Short-Form Commercial Building Permit Application -- Interior Floor
-- Area and Minor Exterior Alterations, Change of Use, Renovations" (linked
-- from edmonton.ca's Forms Listing as "Commercial Building Permit Application
-- for Interior Alterations (Short-Form)"; footer "February 2026"; references
-- NBC(AE) 2023). Stored as edmonton/commercial-interior-alterations-short-form.pdf.
-- It has no form fields, so it is filled by coordinate overlay like ESA's:
-- each position below was measured from the PDF's text layer (labels sit at
-- the top of each box, values go just under them) and checked by rendering a
-- filled copy. Edmonton was parked earlier only because no overlay workflow
-- had been proven; ESA's (migration 072) now is.
--
-- Submission: the form itself says "Applications should be submitted on
-- selfserve.edmonton.ca"; the City's "Changes to Existing Buildings and Sites"
-- page confirms online application there (checked 2026-09-30).
--
-- Field map: project address, project name, description (wrapped to its
-- box), cost of construction, the applicant's name/company/email, the
-- constructor's company, and the area of work (with its unit). Owner,
-- contractor trade sections, checkboxes and the plan/structural answers are
-- left for the contractor. The applicant declaration takes the signer's
-- printed name, signature and date.
--
-- Also: permit_form_fields gains overlay_max_width / overlay_max_lines so a
-- long value wraps inside its box instead of running off the page, and
-- overlay_font_size for tight table cells (Edmonton's applicant/constructor
-- cells are ~18pt tall with a label in the top half; values print at 6pt).

alter table permit_form_fields
  add column overlay_max_width numeric check (overlay_max_width is null or overlay_max_width > 0),
  add column overlay_max_lines integer check (overlay_max_lines is null or overlay_max_lines > 0),
  add column overlay_font_size numeric check (overlay_font_size is null or overlay_font_size between 4 and 14),
  add constraint permit_form_fields_overlay_wrap_needs_overlay check (
    (overlay_max_width is null and overlay_max_lines is null and overlay_font_size is null) or overlay_x is not null
  );

insert into jurisdictions (id, country, province_code, municipality, region, unit_system, portal_url, coverage_level, verified_at)
values
  ('00000000-0000-0000-0001-00000000000b', 'CA', 'AB', 'Edmonton', null, 'metric',
   'https://www.edmonton.ca/business_economy/changes-to-existing-buildings',
   'assisted', null)
on conflict (id) do nothing;

insert into authorities (id, name, authority_level, province_code, jurisdiction_id, portal_url, filing_mechanism,
                         submission_instructions, office_address)
values
  ('00000000-0000-0000-0002-00000000000c', 'City of Edmonton - Development Services', 'municipal', 'AB',
   '00000000-0000-0000-0001-00000000000b',
   'https://selfserve.edmonton.ca/',
   'portal',
   'Apply online at selfserve.edmonton.ca with the completed Short-Form (pages 1 and 2 only) and one copy of the drawings. Electrical, plumbing, gas and HVAC work need their own trade permits. Questions: 311 (780-442-5311 outside Edmonton) or developmentservices@edmonton.ca.',
   'Edmonton Tower, 2nd Floor, 10111 - 104 Avenue NW, Edmonton, AB T5J 0J4')
on conflict (id) do nothing;

insert into permit_types (id, jurisdiction_id, title, required_form_template_path, compliance_rules, version, verified_at, verified_by)
values
  ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0001-00000000000b',
   'Commercial Tenant Improvement', 'edmonton/commercial-interior-alterations-short-form.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'cities-2026-09-30')
on conflict (id) do nothing;

insert into permit_type_filings (id, permit_type_id, authority_id, sequence, is_conditional_on, form_template_path)
values
  ('00000000-0000-0000-0004-00000000000c', '00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0002-00000000000c', 1, null,
   'edmonton/commercial-interior-alterations-short-form.pdf')
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from permit_form_fields where permit_type_filing_id = '00000000-0000-0000-0004-00000000000c') then
    insert into permit_form_fields
      (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y, overlay_max_width, overlay_max_lines, overlay_font_size)
    values
      -- 1 PROJECT MUNICIPAL ADDRESS (value under the label), YOUR PROJECT NAME (after its label)
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'application.projectAddress', true, 1, 49.0, 566.5, 515, 1, null),
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'application.projectTitle', false, 1, 128.0, 549.8, 430, 1, null),
      -- 2 DESCRIPTION OF PROPOSED WORK (two lines in its box)
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'application.projectDescription', true, 1, 49.0, 519.5, 515, 2, null),
      -- 4 COST of CONSTRUCTION, after the "$"
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'application.estimatedJobValueDollars', true, 1, 489.0, 435.0, 78, 1, null),
      -- 5 PROJECT APPLICANT: last name, first name, company, email (under each cell label)
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'applicant.lastName', true, 1, 47.5, 363.6, 198, 1, 6),
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'applicant.firstName', true, 1, 250.7, 363.6, 112, 1, 6),
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'contractor.companyName', false, 1, 368.5, 363.6, 92, 1, 6),
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'applicant.email', true, 1, 47.5, 326.1, 198, 1, 6),
      -- 7 CONSTRUCTOR: company
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'contractor.companyName', false, 1, 368.5, 204.6, 92, 1, 6),
      -- 9 AREA of WORK (page 2), with its unit
      ('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0004-00000000000c', null, 'application.squareMetresWithUnit', false, 2, 486.5, 700.0, 46, 1, null);
  end if;
end $$;

-- Applicant declaration (page 2): printed name after "I, (PRINT NAME)", the
-- signature line after "PROJECT APPLICANT Signature", the date after "Date".
insert into permit_form_signature_slots
  (permit_type_filing_id, signer_role, page, x, y, width, height,
   signature_pdf_field_name, name_pdf_field_name, name_x, name_y, date_pdf_field_name, date_x, date_y, date_format)
values
  ('00000000-0000-0000-0004-00000000000c', 'applicant', 2, 222, 110.5, 190, 12,
   null, null, 201.0, 174.0, null, 434.0, 111.0, 'yyyy-mm-dd')
on conflict (permit_type_filing_id, signer_role) do nothing;
