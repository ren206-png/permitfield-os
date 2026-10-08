-- Toronto, ON: Commercial Tenant Improvement on Ontario's 2026 provincial form,
-- and Toronto's building filing for Electrical Service Upgrade moved to it.
--
-- Toronto's "Interior Alterations (Non-Residential)" application guide (date
-- modified February 13, 2026) covers interior alterations to an existing
-- building with no added floor area, and says that from February 16, 2026 all
-- building permit applications must use the updated Application for a Permit
-- to Construct or Demolish -- the 4-page 2026 provincial form Ottawa and
-- Hamilton already use (migrations 077, 078). Toronto's own forms index still
-- links an older 2-page version (October 2025), which is also what
-- toronto/permit-to-construct-or-demolish.pdf is; the 2026 form is the one the
-- regulation requires, so both Toronto filings use it.
--
-- Submission: the guide's "Apply Online" leads to Toronto Building's Online
-- Services -- Application Submission portal. Toronto also takes some
-- applications by email (bldapplications@toronto.ca, attachments up to 25 MB),
-- but its list of email-eligible application types could not be read
-- (2026-10-08), so the filing stays 'portal' (recorded by the contractor) and
-- the instructions mention email only as an option to check.
--
-- The requirements below are the guide's Required Documentation and Required
-- Forms, pending review like migration 080's.

-- 1. Electrical Service Upgrade: Toronto's building filing moves to the 2026
--    form with Ottawa's field map (same field names and signature slot).
update permit_types
set required_form_template_path = 'ontario/permit-to-construct-or-demolish-2026.pdf'
where id = '00000000-0000-0000-0003-000000000001';

update permit_type_filings
set form_template_path = 'ontario/permit-to-construct-or-demolish-2026.pdf'
where id = '00000000-0000-0000-0004-000000000001';

delete from permit_form_fields where permit_type_filing_id = '00000000-0000-0000-0004-000000000001';
insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
select '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y
from permit_form_fields
where permit_type_filing_id = '00000000-0000-0000-0004-00000000000a';

update authorities
set submission_instructions = 'Apply online through Toronto Building''s Online Services (Application Submission) from the application guide''s "Apply Online" button, with every drawing, report and form as an unsecured PDF. Some smaller applications can instead be emailed to bldapplications@toronto.ca (attachments up to 25 MB, project address in the subject); check that your application type is eligible first. Fees are requested after the completeness check.',
    portal_url = 'https://www.toronto.ca/services-payments/building-construction/building-permit/before-you-apply-for-a-building-permit/building-permit-application-guides/guides-for-other-buildings/interior-alterations-non-residential/'
where id = '00000000-0000-0000-0002-000000000001';

-- 2. Commercial Tenant Improvement in Toronto.
insert into permit_types (id, jurisdiction_id, title, required_form_template_path, compliance_rules, version, verified_at, verified_by)
values
  ('00000000-0000-0000-0003-00000000000c', '00000000-0000-0000-0001-000000000001',
   'Commercial Tenant Improvement', 'ontario/permit-to-construct-or-demolish-2026.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'cities-2026-10-08')
on conflict (id) do nothing;

insert into permit_type_filings (id, permit_type_id, authority_id, sequence, is_conditional_on, form_template_path)
values
  ('00000000-0000-0000-0004-00000000000d', '00000000-0000-0000-0003-00000000000c', '00000000-0000-0000-0002-000000000001', 1, null,
   'ontario/permit-to-construct-or-demolish-2026.pdf')
on conflict (id) do nothing;

insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
select '00000000-0000-0000-0003-00000000000c', '00000000-0000-0000-0004-00000000000d', pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y
from permit_form_fields
where permit_type_filing_id = '00000000-0000-0000-0004-00000000000a'
  and not exists (select 1 from permit_form_fields where permit_type_filing_id = '00000000-0000-0000-0004-00000000000d');

insert into permit_form_signature_slots
  (permit_type_filing_id, signer_role, page, x, y, width, height,
   signature_pdf_field_name, name_pdf_field_name, name_x, name_y, date_pdf_field_name, date_x, date_y, date_format)
values
  ('00000000-0000-0000-0004-00000000000d', 'applicant', 2, 190, 204, 322, 18,
   'Signature of applicant', 'Name of Applicant for Declaration', null, null, 'Date Applicant Signed Main Form', null, null, 'yyyy-mm-dd')
on conflict (permit_type_filing_id, signer_role) do nothing;

-- The provincial form's "Project unit number" box, on every Ontario filing:
-- the unit now parsed out of addresses like "Unit 210, 100 King St W, ..."
-- (application.addressUnit, lib/pdf/resolve-fields.ts).
insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required)
select f.permit_type_id, f.id, 'Project unit number', 'application.addressUnit', false
from permit_type_filings f
where f.id in ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0004-00000000000a',
               '00000000-0000-0000-0004-00000000000b', '00000000-0000-0000-0004-00000000000d')
  and not exists (
    select 1 from permit_form_fields x where x.permit_type_filing_id = f.id and x.pdf_field_name = 'Project unit number'
  );

-- 3. Toronto's submission requirements (pending review).
insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-00000000000c', '00000000-0000-0000-0001-000000000001', 'forms_page',
   'https://www.toronto.ca/services-payments/building-construction/building-permit/before-you-apply-for-a-building-permit/building-permit-application-guides/guides-for-other-buildings/interior-alterations-non-residential/',
   '2026-10-08', 'pending_review', 'Interior Alterations (Non-Residential) application guide, date modified February 13, 2026: Required Documentation and Required Forms.')
on conflict (id) do nothing;

do $$
declare
  v_items jsonb := $json$[
    {"title": "Application for a Permit to Construct or Demolish (2026 form)", "description": "The updated provincial form required from February 16, 2026, completed and signed, as a PDF."},
    {"title": "Site plan", "description": "Property lines and lot area (from a current survey), key plan of the work, buildings with setbacks, zoning summary, fire route, fire department connections and hydrants, parking and loading, and barrier-free details."},
    {"title": "Architectural floor plans", "description": "Dimensioned plans of each level with existing and proposed uses, plumbing fixtures, reflected ceiling, wall assemblies, fire separations and structural framing above. To scale, signed and dated; a qualified designer's name, registration number, BCIN and stamp where they prepared them. No personal information on plans."},
    {"title": "Roof plan", "description": "Existing and proposed roof layout: structure, skylights, slopes, ventilation and screening for rooftop mechanical equipment."},
    {"title": "Sections", "description": "Cross sections of existing and proposed construction with floor, wall and roof assemblies, heights, fire separations, stairs, landings, guards and handrails."},
    {"title": "Construction details and notes", "description": "Materials and specifications of assemblies, typical wall section and roof detail, guard details, door and room finish schedules."},
    {"title": "Existing Life Safety Systems form", "description": "Information about the building's life safety systems. The Building Design Information Form or an OBC matrix may be used instead."},
    {"title": "Schedule 1: Designer Information Form", "description": "Completed by the designer; property owners who are exempt state the reason.", "when": "Required unless the designer is a licensed architect or engineer."},
    {"title": "Commitment to General Reviews by Architect and Engineer", "description": "Signed by the owner or agent and the architect, engineer or consultant.", "when": "Required where the Ontario Building Code requires professional design and field review."}
  ]$json$;
begin
  if not exists (select 1 from permit_requirements where permit_type_id = '00000000-0000-0000-0003-00000000000c') then
    insert into permit_requirements
      (jurisdiction_id, permit_type_id, source_id, verification_status, display_order, title, description, applies_when)
    select '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0003-00000000000c', '00000000-0000-0000-0005-00000000000c',
           'pending_review', item.ordinality::integer, item.value->>'title', item.value->>'description', item.value->>'when'
    from jsonb_array_elements(v_items) with ordinality as item;
  end if;
end $$;
