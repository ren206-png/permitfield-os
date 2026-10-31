-- Richmond's 2026 building permit fees, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097). Same pattern as 099, 101, 104, 105.
--   * Consolidated Fees Bylaw No. 8636, Amendment Bylaw No. 10702 (staff
--     report of September 23, 2025 with the bylaw and its schedules),
--     in force January 1, 2026; adopted by Council on November 10, 2025
--     (motion R25/19-14, carried). Schedule "Building Regulation", Building
--     Permit Fees for all Other Building Types: $98.25 minimum up to $1,000;
--     $16.75 per $1,000 to $100,000; $14.25 per $1,000 to $300,000; $11.00
--     per $1,000 above. richmond.ca's own consolidation stops at the 2024
--     amendments, so the adopted 2026 amendment is the current source.
-- citycouncil.richmond.ca serves the PDF to the automated check and its
-- robots.txt allows the path.
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000012';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000012', '00000000-0000-0000-0001-000000000007', 'fee_schedule',
   'https://citycouncil.richmond.ca/__shared/assets/_2_-_Consolidated_Fees_Bylaw_No77859.pdf',
   '2026-10-31', 'pending_review', 'Consolidated Fees Bylaw No. 8636, Amendment Bylaw No. 10702 (in force January 1, 2026; adopted November 10, 2025): building permit fees for all other building types.')
on conflict (id) do nothing;
