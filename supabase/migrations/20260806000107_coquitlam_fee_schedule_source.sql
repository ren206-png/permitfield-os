-- Coquitlam's 2026 building permit fees, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097). Same pattern as 099-106.
--   * Fees and Charges Bylaw No. 5484, 2025 (consolidated with 5551, 2026),
--     in force January 1, 2026; final adoption December 15, 2025. Schedule
--     "D", Building Bylaw Fees & Charges, Table 1 (without a registered
--     professional) and Table 2 (with): base fee plus a rate per $1,000 of
--     estimated construction value by value band. This is the City's own
--     "Fees and Charges Bylaw Schedule D (PDF)" link.
-- publicdocs.coquitlam.ca answers robots.txt with HTTP 503, and the source
-- check treats an unreadable robots.txt as "do not fetch" (RFC 9309), so this
-- source is captured by admin upload (record_source_upload, 100), like
-- Vancouver's (101).
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000013';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000013', '00000000-0000-0000-0001-000000000008', 'fee_schedule',
   'https://publicdocs.coquitlam.ca/coquitlamdoc/getdocIF.asp?doc=6285879',
   '2026-11-01', 'pending_review', 'Fees and Charges Bylaw No. 5484, 2025 (in force January 1, 2026; adopted December 15, 2025): Schedule D building permit fees. publicdocs.coquitlam.ca robots.txt returns 503, so capture by upload.')
on conflict (id) do nothing;
