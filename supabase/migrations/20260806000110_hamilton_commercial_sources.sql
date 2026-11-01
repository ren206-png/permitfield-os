-- Hamilton's commercial requirements and building permit fees, registered as
-- sources so its Commercial Tenant Improvement rule set and fee schedule can
-- be published (publish_rule_set_version 093, publish_fee_schedule_version
-- 097). Same pattern as 080 and 099-109.
--   * "Building Permits for Small Businesses" (date modified July 7, 2026):
--     Hamilton's own page for retail stores and restaurants. Source 0a, the
--     general "Building Permit Application Requirements" page, sits under
--     Residential Building & Renovation and says interior renovation
--     requirements "may vary based on scope of work"; this page lists the
--     drawings a commercial application must include. Items added below
--     follow 080's transcription rules; truss details and site plan approval
--     for new buildings are left out (new structures only).
--   * "Building Permit Fees" (date modified March 3, 2025): Schedule A to
--     Building By-law 15-058, consolidated January 31, 2025 with amending
--     By-law 25-008 (the latest; no 2026 amendment found). Permit fee =
--     service index x floor area; office finishing only $5.85/m2, retail
--     $5.07, assembly $6.18; $291 minimum.
-- hamilton.ca serves both pages to the automated check and its robots.txt
-- allows the paths.
--
-- New requirements start 'pending_review'; an admin verifies them in
-- /admin/requirements before the rule set is published.
--
-- Rollback (valid while no source_revisions or rule_set_version_items
-- reference them):
--   delete from permit_requirements where id in (
--     '9189b216-70b4-40cd-8872-05aca877c291', '48e1660b-9bc1-4938-b8c3-888410abf747',
--     'fa85686a-0372-4d6d-979b-b1371d06f9de', 'e76074d5-2ed7-40ab-9cab-169d89357730',
--     'dc6729ba-4c22-4e44-b3c9-812ce6edb750');
--   delete from jurisdiction_sources where id in (
--     '00000000-0000-0000-0005-000000000016', '00000000-0000-0000-0005-000000000017');

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000016', '00000000-0000-0000-0001-000000000004', 'forms_page',
   'https://www.hamilton.ca/build-invest-grow/starting-small-business/permits-inspections/building-permits-small-businesses',
   '2026-11-01', 'pending_review', 'Building Permits for Small Businesses (date modified July 7, 2026): checklist for retail stores and restaurants and the drawings to submit.'),
  ('00000000-0000-0000-0005-000000000017', '00000000-0000-0000-0001-000000000004', 'fee_schedule',
   'https://www.hamilton.ca/build-invest-grow/construction-renovation/residential-building-renovation/building-permit-fees',
   '2026-11-01', 'pending_review', 'Building Permit Fees (date modified March 3, 2025): Schedule A to Building By-law 15-058 as amended by By-law 25-008; fee = service index x floor area, $291 minimum.')
on conflict (id) do nothing;

insert into permit_requirements
  (id, jurisdiction_id, permit_type_id, source_id, verification_status, display_order, title, description, applies_when)
values
  ('9189b216-70b4-40cd-8872-05aca877c291', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0003-00000000000a',
   '00000000-0000-0000-0005-000000000016', 'pending_review', 8,
   'Floor plans for each floor', 'With details showing compliance with the Ontario Building Code.', null),
  ('48e1660b-9bc1-4938-b8c3-888410abf747', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0003-00000000000a',
   '00000000-0000-0000-0005-000000000016', 'pending_review', 9,
   'Elevations and cross sections', null, null),
  ('fa85686a-0372-4d6d-979b-b1371d06f9de', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0003-00000000000a',
   '00000000-0000-0000-0005-000000000016', 'pending_review', 10,
   'Mechanical, structural and/or electrical plans or data', null, null),
  ('e76074d5-2ed7-40ab-9cab-169d89357730', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0003-00000000000a',
   '00000000-0000-0000-0005-000000000016', 'pending_review', 11,
   'Plot plan, survey or site plan', null, null),
  ('dc6729ba-4c22-4e44-b3c9-812ce6edb750', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0003-00000000000a',
   '00000000-0000-0000-0005-000000000016', 'pending_review', 12,
   'Grease interceptor and commercial cooking exhaust by a professional engineer',
   'A licensed professional engineer is needed to install an oil or grease interceptor and a commercial cooking exhaust.',
   'For restaurants.')
on conflict (id) do nothing;
