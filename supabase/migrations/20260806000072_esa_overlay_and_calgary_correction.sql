-- Auto-fill: ESA field map, and a correction to Calgary's template.
--
-- 1. ESA's "Low Voltage Industrial/Commercial/Agricultural" notification
--    (Form 1015LV_A, 06/26 -- the file stored at esa/icia-low-voltage.pdf)
--    has no AcroForm fields, so it is filled by coordinate overlay. Each x,y
--    below is the end of the printed label plus 3pt, on the label's own
--    baseline, measured from the PDF's text layer (pdfjs getTextContent);
--    values print at OVERLAY_FONT_SIZE (7pt, matching the form's 7.4-8.2pt
--    labels). Only fields the application reliably knows are mapped. The
--    payment method, signature/declaration, date, "Ready For", equipment
--    tables and job-type checkboxes are left for the contractor: they are the
--    contractor's own attestations and choices, and ESA requires credit-card
--    payment by phone, never on the form.
--
-- 2. The file stored as Calgary's "Commercial Tenant Improvement" template
--    (calgary/commercial-building-project-application.pdf) is actually
--    Calgary's "Home Energy Label Program - New Home Pilot - Letter of
--    Intent", an unrelated voluntary rebate form for new low-density homes.
--    Calgary has no PDF application form for commercial alterations: its own
--    page (calgary.ca/development/commercial/alterations.html, checked
--    2026-09-26) directs applicants to apply online at apply.calgary.ca
--    (myID account required) or in person at the Planning Services Centre.
--    The template path is cleared so the wrong document is never generated,
--    and the authority now points at the real portal with the checklist to
--    follow. lib/inngest/functions/generate-pdf.ts treats a permit type with
--    no fillable form as nothing-to-generate rather than a failure.

do $$
begin
  if not exists (
    select 1 from permit_form_fields where permit_type_filing_id = '00000000-0000-0000-0004-000000000002'
  ) then
    insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
    values
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'contractor.primaryLicenseNumber', true,  1, 137.3, 664.4),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'contractor.companyName',          true,  1,  85.9, 582.6),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'applicant.email',                false, 1, 299.9, 565.3),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'application.projectTitle',       false, 1,  98.5, 536.9),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'application.addressCivicNumber', true,  1,  81.2, 528.2),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'application.addressStreet',      true,  1, 166.3, 528.2),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'application.addressCity',        true,  1, 387.4, 528.2),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'applicant.fullName',             false, 1, 112.3, 492.4),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'applicant.email',                false, 1, 328.9, 492.4),
      ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000002', null, 'application.electricalAmps',     false, 1, 129.2, 453.2);
  end if;
end $$;

update permit_type_filings
set form_template_path = null
where id = '00000000-0000-0000-0004-000000000003'
  and form_template_path = 'calgary/commercial-building-project-application.pdf';

update permit_types
set required_form_template_path = null
where id = '00000000-0000-0000-0003-000000000002'
  and required_form_template_path = 'calgary/commercial-building-project-application.pdf';

update authorities set
  portal_url = 'https://apply.calgary.ca/myhome',
  submission_instructions = 'Calgary has no PDF application form for commercial alterations. Apply online at apply.calgary.ca (a myID account is required) or in person at the Planning Services Centre, using Calgary''s commercial interior partitioning checklist to assemble the application: https://www.calgary.ca/content/dam/www/pda/pd/documents/carls/building-permit/commercial-interior-partitioning.pdf'
where id = '00000000-0000-0000-0002-000000000003';
