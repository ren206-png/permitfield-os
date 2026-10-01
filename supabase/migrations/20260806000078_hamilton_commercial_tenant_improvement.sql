-- Hamilton, ON: Commercial Tenant Improvement on Ontario's provincial form.
--
-- Ontario's "Application for a Permit to Construct or Demolish" is the form
-- every municipality must use from February 16, 2026 (Ontario CodeNews
-- Issue 377; ontario.ca 2026-01-27 version). Hamilton lists it as its
-- "Common Building Permit Application Form" under Ministry of Municipal
-- Affairs and Housing forms, and takes building permit applications through
-- ePLANS, its online submission system (hamilton.ca "Apply for a Building
-- Permit Online with ePLANS"). So Hamilton reuses Ottawa's template and
-- field map (migration 077) unchanged, including the applicant signature
-- slot and clearing the two stray "ADE" Owner fields.
--
-- Hamilton moves from 'listed' to 'assisted': forms are pre-filled, no AI
-- code review (same tier as Ottawa and the BC cities).

update jurisdictions
set coverage_level = 'assisted',
    portal_url = 'https://www.hamilton.ca/build-invest-grow/construction-renovation/residential-building-renovation/apply-building-permit'
where id = '00000000-0000-0000-0001-000000000004' and coverage_level = 'listed';

insert into authorities (id, name, authority_level, province_code, jurisdiction_id, portal_url, filing_mechanism,
                         submission_instructions, office_address)
values
  ('00000000-0000-0000-0002-00000000000b', 'City of Hamilton - Building Division', 'municipal', 'ON',
   '00000000-0000-0000-0001-000000000004',
   'https://www.hamilton.ca/build-invest-grow/construction-renovation/residential-building-renovation/apply-building-permit',
   'portal',
   'Apply online through ePLANS. All documents must be PDFs that are not password protected, and drawings must be vector PDFs (not scans). Questions: Building Division, 905-546-2720.',
   'City Hall, 3rd Floor, 71 Main Street West, Hamilton, ON L8P 4Y5')
on conflict (id) do nothing;

insert into permit_types (id, jurisdiction_id, title, required_form_template_path, compliance_rules, version, verified_at, verified_by)
values
  ('00000000-0000-0000-0003-00000000000a', '00000000-0000-0000-0001-000000000004',
   'Commercial Tenant Improvement', 'ontario/permit-to-construct-or-demolish-2026.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'cities-2026-09-30')
on conflict (id) do nothing;

insert into permit_type_filings (id, permit_type_id, authority_id, sequence, is_conditional_on, form_template_path)
values
  ('00000000-0000-0000-0004-00000000000b', '00000000-0000-0000-0003-00000000000a', '00000000-0000-0000-0002-00000000000b', 1, null,
   'ontario/permit-to-construct-or-demolish-2026.pdf')
on conflict (id) do nothing;

-- Same map as Ottawa's filing (0004-...0a), copied row for row.
insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
select '00000000-0000-0000-0003-00000000000a', '00000000-0000-0000-0004-00000000000b', pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y
from permit_form_fields
where permit_type_filing_id = '00000000-0000-0000-0004-00000000000a'
  and not exists (select 1 from permit_form_fields where permit_type_filing_id = '00000000-0000-0000-0004-00000000000b');

insert into permit_form_signature_slots
  (permit_type_filing_id, signer_role, page, x, y, width, height,
   signature_pdf_field_name, name_pdf_field_name, name_x, name_y, date_pdf_field_name, date_x, date_y, date_format)
values
  ('00000000-0000-0000-0004-00000000000b', 'applicant', 2, 190, 204, 322, 18,
   'Signature of applicant', 'Name of Applicant for Declaration', null, null, 'Date Applicant Signed Main Form', null, null, 'yyyy-mm-dd')
on conflict (permit_type_filing_id, signer_role) do nothing;
