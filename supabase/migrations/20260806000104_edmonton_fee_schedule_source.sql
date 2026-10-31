-- Edmonton's official 2026 fee schedule, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097, needs a published revision of a
-- source in the same jurisdiction). Same pattern as 099 (Calgary, Toronto)
-- and 101 (Vancouver). edmonton.ca serves the PDF to the automated check.
--   * 2026 Planning and Development Fee Schedules (effective January 1, 2026).
--     Section 3, Building Permits: new or additions/alterations commercial,
--     industrial, institutional -- $11.00 per $1,000 of construction value up
--     to $1,000,000, $10.00 per $1,000 above, $285 minimum; Safety Codes fee 4%.
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000010';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000010', '00000000-0000-0000-0001-00000000000b', 'fee_schedule',
   'https://www.edmonton.ca/sites/default/files/public-files/2026-Planning-and-Development-Fee-Schedules.pdf',
   '2026-10-31', 'pending_review', '2026 Planning and Development Fee Schedules, effective January 1, 2026: Section 3 building permit fees for commercial additions/alterations and the Safety Codes fee.')
on conflict (id) do nothing;
