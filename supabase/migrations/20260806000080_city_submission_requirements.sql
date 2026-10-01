-- Per-city submission requirements: what each authority's own published
-- checklist says a Commercial Tenant Improvement application (and Toronto's
-- Electrical Service Upgrade) must include, one permit_requirements row per
-- checklist item, each pointing at the checklist it came from
-- (jurisdiction_sources). Form generation and "Add suggested items" copy these
-- onto the application's readiness checklist (lib/readiness/add-suggested-items.ts),
-- so "Ready to submit" means that city's list is done, not just a generic one.
--
-- Every row is 'pending_review': the items were transcribed from the sources
-- below on 2026-09-30, but SS3.4 only lets a named reviewer mark a requirement
-- 'verified' (permit_requirements_verified_requires_all_three), and no one has
-- reviewed them yet. Fees are left null for the same reason ("verified fees
-- only"). None of these rows has a jurisdiction_permit_rules row, so the
-- project evaluator (20260806000027) never matches them -- they feed the
-- application checklist only.
--
-- Transcription rules: an item the checklist marks required (or lists with no
-- condition) has applies_when null and becomes a required checklist item; an
-- item the checklist makes conditional ("if applicable", "required if ...")
-- carries that condition in applies_when and becomes an optional checklist
-- item, since only the contractor knows whether their scope triggers it.
-- Items that only concern new buildings, additions or residential units
-- (surveys, geotechnical reports, HPO forms, landscaping, civil drawings) are
-- left out.
--
-- Sources (retrieved 2026-09-30):
--   Surrey       "Tenant & Landlord Improvement Building Permit Application Checklist" (last updated July 2025)
--   Calgary      "Building Permit Application Requirement List -- Interior Partitioning"
--   Edmonton     COE-SCPI-GUID-0001 "Commercial Building Permit - Minimum Application Requirements Guide" v3 2026-09-01, Interior Alteration column
--   Vancouver    "Commercial Building Renovation -- Building Permit Application Requirements" DOC/2022/227241, updated March 2026
--   Richmond     PL-43 "Building Permit Application Form -- Addition and Alterations" Part D, rev. Feb 17, 2026
--   Coquitlam    "Checklist -- Tenant Improvement Building Permit" Doc #3949561.v4
--   Port Coq.    Tenant Improvement page + the checklist on its application form (last edited October 2021)
--   Maple Ridge  "Building Permit Application Checklist For Landlord/Tenant Improvement" revised 2025-04-28 (* items are mandatory)
--   Ottawa       "Building permit application submission requirements -- Small, large and complex buildings", Tenant Fit ups/Renovations
--   Hamilton     "Building Permit Application Requirements" page (date modified September 11, 2026)
--   Toronto/ESA  ESA "File a Notification/Permit" forms page (Toronto's own permit is only needed on a structural or enclosure change)

alter table permit_requirements
  add column display_order integer,
  add column applies_when text check (applies_when is null or length(trim(applies_when)) > 0);

comment on column permit_requirements.applies_when is
  'Null when the source lists the item as always required; otherwise the source''s own condition. Conditional items are optional on the application checklist.';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0001-000000000005', 'forms_page',
   'https://www.surrey.ca/sites/default/files/media/documents/tenant-landlord-improvement-checklist.pdf',
   '2026-09-30', 'pending_review', 'Tenant & Landlord Improvement Building Permit Application Checklist, last updated July 2025. Mandatory with every application; package goes to permitapplication@surrey.ca.'),
  ('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0001-000000000002', 'forms_page',
   'https://www.calgary.ca/content/dam/www/pda/pd/documents/carls/building-permit/commercial-interior-partitioning.pdf',
   '2026-09-30', 'pending_review', 'Building Permit Application Requirement List -- Interior Partitioning.'),
  ('00000000-0000-0000-0005-000000000003', '00000000-0000-0000-0001-00000000000b', 'forms_page',
   'https://www.edmonton.ca/sites/default/files/public-files/assets/PDF/Commercial_BP_Minimum_Submission.pdf',
   '2026-09-30', 'pending_review', 'COE-SCPI-GUID-0001 v3 2026-09-01, Table 1 Interior Alteration column.'),
  ('00000000-0000-0000-0005-000000000004', '00000000-0000-0000-0001-000000000006', 'forms_page',
   'https://vancouver.ca/files/cov/renovation-commercial-building-checklist.pdf',
   '2026-09-30', 'pending_review', 'Commercial Building Renovation Building Permit Application Requirements, DOC/2022/227241, updated March 2026.'),
  ('00000000-0000-0000-0005-000000000005', '00000000-0000-0000-0001-000000000007', 'forms_page',
   'https://www.richmond.ca/__shared/assets/pl4356639.pdf',
   '2026-09-30', 'pending_review', 'PL-43 Building Permit Application Form -- Addition and Alterations, Part D Submission Requirements, rev. Feb 17, 2026.'),
  ('00000000-0000-0000-0005-000000000006', '00000000-0000-0000-0001-000000000008', 'forms_page',
   'https://www.coquitlam.ca/DocumentCenter/View/1026',
   '2026-09-30', 'pending_review', 'Checklist -- Tenant Improvement Building Permit, Doc #3949561.v4.'),
  ('00000000-0000-0000-0005-000000000007', '00000000-0000-0000-0001-000000000009', 'forms_page',
   'https://www.portcoquitlam.ca/business-development/property-development-building/building-permits/tenant-improvement',
   '2026-09-30', 'pending_review', 'Tenant Improvement page and the Building Permit Checklist on the application form (last edited October 2021); for tenant improvements some items may not apply.'),
  ('00000000-0000-0000-0005-000000000008', '00000000-0000-0000-0001-00000000000a', 'forms_page',
   'https://www.mapleridge.ca/media/file/tenantlandlord-improvement-checklist',
   '2026-09-30', 'pending_review', 'Building Permit Application Checklist For Landlord/Tenant Improvement, revised 2025-04-28.'),
  ('00000000-0000-0000-0005-000000000009', '00000000-0000-0000-0001-000000000003', 'forms_page',
   'https://ottawa.ca/en/planning-development-and-construction/building-and-renovating/planning-your-project/building-permit-application-submission-requirements-small-large-and-complex-buildings',
   '2026-09-30', 'pending_review', 'Tenant Fit ups/Renovations Requirements section.'),
  ('00000000-0000-0000-0005-00000000000a', '00000000-0000-0000-0001-000000000004', 'forms_page',
   'https://www.hamilton.ca/build-invest-grow/construction-renovation/residential-building-renovation/building-permit',
   '2026-09-30', 'pending_review', 'Building Permit Application Requirements (forms, submission standards, fees); date modified September 11, 2026.'),
  ('00000000-0000-0000-0005-00000000000b', '00000000-0000-0000-0001-000000000001', 'forms_page',
   'https://esasafe.com/fees-and-forms/forms/',
   '2026-09-30', 'pending_review', 'ESA forms page, Submit a New Notification/Permit. ESA is province-wide; filed under Toronto because the Electrical Service Upgrade permit type is Toronto''s.')
on conflict (id) do nothing;

-- One block per permit type; skipped when that type already has requirements,
-- so re-running against a database that has them is a no-op.
create function pg_temp.add_requirements(
  p_permit_type_id uuid,
  p_source_id uuid,
  p_items jsonb
) returns void
language plpgsql
as $$
begin
  if exists (select 1 from permit_requirements where permit_type_id = p_permit_type_id) then
    return;
  end if;
  insert into permit_requirements
    (jurisdiction_id, permit_type_id, source_id, verification_status, display_order, title, description, applies_when)
  select pt.jurisdiction_id, p_permit_type_id, p_source_id, 'pending_review', item.ordinality::integer,
         item.value->>'title', item.value->>'description', item.value->>'when'
  from permit_types pt
  cross join jsonb_array_elements(p_items) with ordinality as item
  where pt.id = p_permit_type_id;
end;
$$;

-- Surrey
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0005-000000000001', $json$[
  {"title": "Building permit application form", "description": "Include the unit number(s) on the form, drawings and documents."},
  {"title": "Tenant & Landlord Improvement checklist", "description": "Surrey's checklist is mandatory: complete it and submit it with the application."},
  {"title": "Site plan", "description": "To scale, minimum 1/8\" = 1'0\", compliant with the current BC Building Code."},
  {"title": "Floor plans, cross sections, elevations and construction details", "description": "To scale, minimum 1/8\" = 1'0\"; 4 sets of plans per discipline for paper submissions.", "when": "As the scope of work needs them."},
  {"title": "Structural and mechanical drawings, signed and sealed", "description": "Signed and sealed by a Registered Professional.", "when": "If there is structural or mechanical work."},
  {"title": "Isometric plumbing drawings", "description": "For new fixtures and drains.", "when": "If plumbing fixtures or drains are added."},
  {"title": "Owner's Authorization Form", "description": "Authorizes the applicant to apply for the owner.", "when": "Required if anyone other than the owner signed the application form."},
  {"title": "Bylaw & Licensing Inquiry response or Surrey business licence", "description": "The inquiry response letter, or a copy of the current Surrey Business Licence for the same location.", "when": "Not required for unoccupied locations."},
  {"title": "Schedule A, Schedule B and certificates of insurance", "description": "Schedule B and a certificate of insurance from each Registered Professional; Schedule A (with the owner's name, address and signature on page 2) when there is more than one.", "when": "If Registered Professionals are involved."},
  {"title": "Strata approval letter", "description": "Signed by the property manager for the strata or a strata council member.", "when": "Required when renovations affect common property (e.g. plumbing) or the exterior."},
  {"title": "Fraser Health approval", "when": "Required for food handling and personal services."},
  {"title": "Parking calculation", "description": "For the whole property and all its uses.", "when": "Required for a change of use or new floor area (e.g. a mezzanine)."}
]$json$::jsonb);

-- Calgary
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0005-000000000002', $json$[
  {"title": "Approved development permit", "description": "Building permit plans must match the plans the development authority approved.", "when": "If the Land Use Bylaw requirements are not met."},
  {"title": "Building permit fee", "description": "Paid with the application; see Calgary's fee schedule or fee calculator."},
  {"title": "Site plan (1 copy)", "description": "Shows the exact location of the tenant space within the building and the tenant unit number."},
  {"title": "Floor plans with building code analysis (1 copy)", "description": "Code analysis (base building classification, construction type, egress per articles 3.3.1.5 and 3.4.2.1), room dimensions and uses, walls and openings, wall and partition construction, exits, and floor/wall/ceiling finishes. No personal information; no \"not for construction\", \"preliminary\" or \"for permit purposes only\" stamps."},
  {"title": "Asbestos Abatement Form", "when": "Required for buildings constructed before 1990."},
  {"title": "Request for Specific Variance Form", "description": "Plus one copy of the variance report if requested.", "when": "If a variance or alternative solution is requested."},
  {"title": "Restaurants and Food Establishments documents", "description": "The additional items from Calgary's Restaurants and Food Establishments requirement list, plus a seating plan.", "when": "If the application is for a restaurant or drinking establishment."},
  {"title": "NECB Project Summary Form and checklists (Parts 4, 5, 6)", "when": "Required for the first tenant in a base building unit constructed after November 1, 2015."}
]$json$::jsonb);

-- Edmonton
select pg_temp.add_requirements('00000000-0000-0000-0003-00000000000b', '00000000-0000-0000-0005-000000000003', $json$[
  {"title": "Code analysis", "description": "Code editions, building classification, municipal address, building area, design occupant loads, washroom count and travel distances to exits."},
  {"title": "Floor plan", "description": "At 1:100 (1/8\" = 1') or larger with a north arrow; walls, doors, windows, dimensions, room uses, exits, fire-resistance ratings and closures. Show existing and proposed. Labels like \"Not for Construction\" are invalid; split large sets into files of about 20 sheets."},
  {"title": "Key plan", "description": "Floor plan of the entire building showing exactly where the work is, with doorway addresses, suite layouts, exits and demising walls."},
  {"title": "Site plan", "description": "Building location, fire access routes and hydrants.", "when": "Required when the tenant space proposes site changes such as accessible parking or revised fire access routes."},
  {"title": "Elevation drawings", "when": "Required when adding new windows or doors to exterior walls."},
  {"title": "Sections and details", "description": "Insulation, air barrier, vapour barrier and cladding layers.", "when": "Required for demising walls, washrooms or heavy rooftop equipment."},
  {"title": "Structural plans and specifications", "description": "Stamped and authenticated by a registered professional.", "when": "Required for new demising walls over 3.6 m high, mezzanines, or rooftop units that change structural loads."},
  {"title": "Mechanical drawings and specifications", "description": "Equipment, venting, piping, ducts, fire dampers, drains and water distribution.", "when": "Required if HVAC, plumbing layouts or energy components change."},
  {"title": "Electrical drawings and specifications", "description": "Service equipment, emergency lighting, exit signs and fire alarm layouts.", "when": "Required when electrical distribution or life-safety layouts change."},
  {"title": "Energy specifications", "description": "NECB or NBC(AE) 9.36 compliance.", "when": "Required if the base building was permitted after October 31, 2016."},
  {"title": "Schedule A and Schedule B (professional involvement)", "description": "A Coordinating Registered Professional and Schedule A, with a Schedule B for each discipline.", "when": "Required when NBC(AE) Division C, Section 2.4 calls for registered professionals."},
  {"title": "Project Implementation Plan letter of commitment", "description": "Signed PIP Letter of Commitment.", "when": "Required for selective interior demolition."}
]$json$::jsonb);

-- Vancouver
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0005-000000000004', $json$[
  {"title": "Development and/or Building Application Form", "description": "Submit online; fees are assessed at the completeness review and paid before detailed review starts."},
  {"title": "BC Hydro Infrastructure Clearance Declaration Form"},
  {"title": "Building Permit Data Sheet", "description": "Vancouver's data sheet (Excel)."},
  {"title": "Energy compliance documentation", "description": "Using the City's energy requirements forms and checklists."},
  {"title": "Owner's (or Owner's and Tenant's) Undertaking Letter", "description": "Schedule E-1, or Schedule E-2 for owner and tenant."},
  {"title": "Architectural cover sheet", "description": "Project summary, all design professionals' names and contacts, occupant load calculations."},
  {"title": "Architectural floor plans", "description": "Doors, windows, wall assemblies, fire separations, exit signs, emergency lighting, fire alarm devices, room uses, plumbing fixtures, accessibility. Vector PDF, drawings as one file separate from documents."},
  {"title": "Door and window schedule, wall and floor assembly schedule", "description": "Fire-resistance assemblies ULC/CSA listed or tested, or per VBBL Appendix D."},
  {"title": "Architectural key plan", "description": "Address, floor and suite numbers, adjacent occupancies, and the project area on the overall floor plan with the exit system. Scale not less than 1/16\" = 1'-0\".", "when": "Required when work is in a portion of the building only."},
  {"title": "Building code analysis report", "description": "Always recommended.", "when": "Required when the scope is complex; staff will advise."},
  {"title": "Architectural ceiling plans", "description": "Lighting fixtures, bulkheads, finishes and T-bar layout.", "when": "Required if ceiling or lighting alterations are in scope."},
  {"title": "Mechanical, plumbing, electrical and structural plans", "description": "Each discipline as its own file, with sealed Schedule B where required.", "when": "Required for each discipline with changes in scope."},
  {"title": "Schedule A and Schedule B letters of assurance", "description": "Professional seal and digital signature required.", "when": "Schedule A if multiple Registered Professionals; Schedule B per discipline (Part 3 building or structural work)."},
  {"title": "K1 Restaurant or Kitchen Exhaust Systems form", "when": "Required if a commercial kitchen is added or renovated."},
  {"title": "Letter of operation", "when": "Required for childcare, school or change of use."},
  {"title": "Strata council letter", "description": "Signed by the strata chairperson.", "when": "May be required if the building is strata titled."}
]$json$::jsonb);

-- Richmond
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0005-000000000005', $json$[
  {"title": "PL-43 application form", "description": "All fields complete and accurate."},
  {"title": "Letter of Authorization", "description": "Signed by all property owners who are not the applicant; for a corporate owner, a letter from one owner/director on title plus a Notice of Articles."},
  {"title": "Land title search and registered restrictive covenants", "description": "Current title search for each parcel, dated within 60 days of submission."},
  {"title": "Inter-Municipal Business Licence", "description": "Your latest Inter-Municipal Business Licence (IMBL)."},
  {"title": "Architectural drawings", "description": "Coversheet, site plan, floor plans, sections and details, elevations; plus a parking calculation for commercial/industrial businesses (Zoning Bylaw 8500 Section 7)."},
  {"title": "Land Title Freehold Transfer Form A", "description": "With transferor/transferee details.", "when": "Required if the property changed ownership in the last 3 months."},
  {"title": "Letters of assurance and certificates of insurance", "description": "Schedule A (more than one Registered Professional), Schedule B and Schedule E with a certificate of insurance for each, Schedule F signed by all owners.", "when": "Required if Registered Professionals are on the project."},
  {"title": "Structural drawings and engineer's letter", "description": "Framing and foundation plans; a structural engineer's letter confirming a removed wall is not load-bearing.", "when": "If structural work or wall removal is in scope."},
  {"title": "Mechanical drawings", "description": "Coversheet and details.", "when": "Required for changes to commercial cooking ventilation, cooking appliances, HVAC or plumbing."},
  {"title": "Hazardous Materials Declaration Form", "description": "Before permit issuance (Bulletin BUILDING-56).", "when": "Required for a pre-1990 building with hazardous materials."},
  {"title": "Strata approval letter", "when": "If required."}
]$json$::jsonb);

-- Coquitlam
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0005-000000000006', $json$[
  {"title": "Permit application form", "description": "Completed in full; fees based on the value of construction are paid at application."},
  {"title": "Tenant Improvement checklist", "description": "Coquitlam's checklist, signed by the applicant."},
  {"title": "Current title"},
  {"title": "Owner's Acknowledgement Regarding Damage to City Property form"},
  {"title": "Architectural construction drawings (3 sets)", "description": "At 1/8\" = 1'-0\" or greater: room uses, washroom layout and accessibility, exits, new and existing work area calculations, fire separations, cross sections or construction notes, beam and opening sizes."},
  {"title": "Agent Authorization Form", "description": "For permit application and/or file access.", "when": "If applicable."},
  {"title": "Letters of assurance with sealed architectural drawings", "description": "Sealed architectural drawings and Schedule B.", "when": "Required for assembly occupancies over $100,000."},
  {"title": "Sealed structural drawings and Schedule B (2 sets)", "description": "Schedule B complete with full legal description.", "when": "If there is structural work."},
  {"title": "Sealed mechanical drawings and Schedule B (3 copies)", "description": "Schedule B complete with full legal description.", "when": "Required for all large alterations and new restaurant kitchens."},
  {"title": "Schedule A", "description": "Complete with full legal description.", "when": "Required if more than one registered professional is involved."},
  {"title": "Occupant load calculation", "when": "Required if the occupancy classification has changed."},
  {"title": "Electrical drawings (3 sets)", "description": "Emergency lighting, exit signs, etc.", "when": "If electrical work is in scope."},
  {"title": "Plumbing drawings (3 sets)", "description": "With Coquitlam's plumbing permit checklist.", "when": "If plumbing work is in scope."},
  {"title": "Schedule CP-3", "description": "Confirmation of Tenant Improvement Compatibility.", "when": "For base building projects under the Certified Professional Program."}
]$json$::jsonb);

-- Port Coquitlam
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0005-000000000007', $json$[
  {"title": "Application form with fees", "description": "Completed application form; fees per the Fees and Charges Bylaw."},
  {"title": "Form A (owner's acknowledgement)", "description": "Signed acknowledgement of owner."},
  {"title": "Key plan", "description": "Where in the building the work is, and the tenant uses on either side."},
  {"title": "Architectural drawings (3 sets)", "description": "To scale, fully dimensioned: site plan (address, floor and suite numbers), floor plans (room uses, adjacent unit uses, occupant load, accessibility, fire separations and demising wall rating), sections and details."},
  {"title": "Development permit or rezoning approval", "description": "Obtained before the building permit is submitted.", "when": "If the project needs one."},
  {"title": "Building code analysis, signed and sealed", "description": "By a Registered Professional.", "when": "Where Registered Professionals are required."},
  {"title": "Letters of assurance and certificate of insurance", "description": "Schedule B and letter of assurance, signed and sealed, plus a copy of the certificate of liability insurance.", "when": "If Registered Professionals are involved."},
  {"title": "Structural, fire suppression, mechanical and electrical plans", "description": "Signed and sealed drawings.", "when": "For each discipline in scope."}
]$json$::jsonb);

-- Maple Ridge
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000008', '00000000-0000-0000-0005-000000000008', $json$[
  {"title": "Tenant Improvement Application Form", "description": "All sections fully completed; a non-refundable plan processing fee of 35% of the estimated permit fee is paid at application."},
  {"title": "BC Building Code Analysis Summary", "description": "Maple Ridge's code analysis form."},
  {"title": "Owner Acknowledgement Letter"},
  {"title": "Land title search", "description": "Within the last 30 days, for each parcel, with restrictive covenants if applicable."},
  {"title": "Architectural drawings", "description": "Cover sheet, site plan, floor plans, code compliance plans, cross sections, details, elevations, window/door/wall schedules; fire and life safety components clearly identified."},
  {"title": "Letter of Authorization Form", "when": "Required for non-owner building permit applicants."},
  {"title": "Consent to Construction", "description": "Signed by the strata or property manager.", "when": "Required for stratified properties."},
  {"title": "BC Company Summary", "description": "From BC Registry.", "when": "Required if the property is company owned."},
  {"title": "Structural, mechanical, plumbing, fire suppression and electrical drawings", "description": "Signed and sealed by the Professional Engineer, with Schedule B and liability coverage summary.", "when": "For each discipline in scope."},
  {"title": "Schedule A", "when": "If more than one registered professional is involved."},
  {"title": "Fraser Health Authority memo and approved stamped drawings", "when": "For personal services, child care and food services."},
  {"title": "Energy design documentation", "description": "BCBC Part 10, NECB or ASHRAE 90.1.", "when": "If applicable."}
]$json$::jsonb);

-- Ottawa
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000009', '00000000-0000-0000-0005-000000000009', $json$[
  {"title": "Complete permit application details", "description": "Submitted through My ServiceOttawa."},
  {"title": "Digital scaled construction drawings, fully dimensioned", "description": "Complete set, to scale."},
  {"title": "Schedule 1 (designer information)", "description": "Completed with the BCIN designer, architect or engineer."},
  {"title": "Specifications"},
  {"title": "Floor plans", "description": "Full interior partition layouts with rooms identified, the proposed use and occupancy of the tenant space, and required fire separations between tenant spaces."},
  {"title": "Reflected ceiling plan"},
  {"title": "Wall/floor assembly types", "description": "With reference to ULC/SB-2/SB-3 if rated."},
  {"title": "Door, window and hardware schedules"},
  {"title": "Mechanical, electrical and fire protection floor plans", "description": "Plumbing and HVAC layouts with equipment schedules, lighting layouts, sprinkler layouts and fire alarm device locations."},
  {"title": "Confirmation of Commitment by Owner form", "when": "If applicable."},
  {"title": "Key plan", "description": "Location of the tenant space within the building.", "when": "May not be required, depending on the complexity and size of the building."},
  {"title": "Barrier-free washroom details", "description": "Details for the proposed washrooms.", "when": "If washrooms are proposed."},
  {"title": "Structural drawings", "when": "As necessary."},
  {"title": "Mezzanine plan and interior elevations", "description": "Same information as the floor plan.", "when": "If applicable."}
]$json$::jsonb);

-- Hamilton
select pg_temp.add_requirements('00000000-0000-0000-0003-00000000000a', '00000000-0000-0000-0005-00000000000a', $json$[
  {"title": "Building permit application form", "description": "Completed and signed electronically; submitted on the Customer Portal (my.hamilton.ca)."},
  {"title": "Schedule 1 Designer Information Form", "description": "A BCIN designer for buildings up to 600 m2 and three storeys; a professional engineer and/or architect for large buildings and restaurants seating more than 30."},
  {"title": "Applicable Law Checklist", "description": "Required for all applications since July 1, 2023."},
  {"title": "Drawings as vector PDFs, by discipline", "description": "To scale, black and white, not password protected, flattened, comments removed; for non-residential, one PDF per discipline (architectural, structural, mechanical)."},
  {"title": "Building permit fee", "description": "Paid in full at application (over $50,000 you may pay 55% up front); the application is not accepted until paid."},
  {"title": "Zoning verification", "when": "If applicable."},
  {"title": "Encroachment approval", "when": "If the proposal encroaches onto City property."}
]$json$::jsonb);

-- Toronto (Electrical Service Upgrade): ESA
select pg_temp.add_requirements('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0005-00000000000b', $json$[
  {"title": "ESA notification of work (Low Voltage form)", "description": "For installations of 750 V or less; email to esa.cambridge@electricalsafety.on.ca or file by phone."},
  {"title": "ESA notification fee", "description": "Payment is required at the time the notification is submitted."}
]$json$::jsonb);
