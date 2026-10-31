-- Surrey's building permit fee schedule, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097). Same pattern as 099, 101 and 104.
--   * Surrey Building Bylaw, 2012, No. 17850 (consolidated; the City's own
--     link /city-government/bylaws/17850 redirects here). Schedule "A",
--     A.1 Building Permits: $64 for the first $1,000 of building value,
--     $15.00 per $1,000 to $200,000, $11.74 per $1,000 to $500,000, $10.64
--     per $1,000 above. The City's fees summary dates these fees from
--     April 14, 2026.
-- surrey.ca serves the PDF to the automated check, and its robots.txt
-- allows the path (content signals: search=yes, ai-train=no, use=reference).
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000011';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000011', '00000000-0000-0000-0001-000000000005', 'fee_schedule',
   'https://www.surrey.ca/sites/default/files/bylaws/BYL_reg_17850.pdf',
   '2026-10-31', 'pending_review', 'Surrey Building Bylaw, 2012, No. 17850 (consolidated): Schedule "A" A.1 building permit fees by building value; fees summary effective April 14, 2026.')
on conflict (id) do nothing;
