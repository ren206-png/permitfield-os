-- Ottawa's 2026 building permit fees, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097). Same pattern as 099-110.
--   * Building Code Services Fee Schedule -- effective January 1, 2026
--     (Form 20260101). Permit to Construct (all other construction, i.e.
--     not new buildings or additions): $12.75 per $1,000 or part thereof of
--     the assessed valuation of the work, minimum $117.00.
-- The schedule is served from documents.ottawa.ca, which answers the
-- automated check and whose robots.txt allows the path (crawl-delay 10;
-- the check fetches it once a day at most). ottawa.ca itself sits behind
-- Incapsula, so the requirements page (source 09) is captured by upload.
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000018';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000018', '00000000-0000-0000-0001-000000000003', 'fee_schedule',
   'https://documents.ottawa.ca/sites/default/files/bldg_fee_schedule_en_0.pdf',
   '2026-11-01', 'pending_review', 'Building Code Services Fee Schedule, effective January 1, 2026: Permit to Construct (all other construction) $12.75 per $1,000 of assessed valuation, $117 minimum.')
on conflict (id) do nothing;
