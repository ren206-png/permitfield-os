-- Vancouver's official fee schedule, registered as a source (see 099 for
-- Calgary and Toronto). vancouver.ca refuses automated requests, so the daily
-- check will record a failure for it; an admin captures it by uploading the
-- PDF on the source's page (record_source_upload, 100), then publishes the
-- capture and the fee schedule as for the other cities.
--   * 2026 Schedule of Fees for Development & Building Related Permits
--     (fees effective January 1, 2026). Building By-law, Part A, Section 1(a)
--     sets the building permit fee on the estimated cost of the work.
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-00000000000f';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-00000000000f', '00000000-0000-0000-0001-000000000006', 'fee_schedule',
   'https://vancouver.ca/files/cov/vancouver-development-building-permit-fees.pdf',
   '2026-10-29', 'pending_review', '2026 Schedule of Fees for Development & Building Related Permits, effective January 1, 2026: Building By-law Part A, building permit fee on the estimated cost of the work. vancouver.ca blocks automated fetches; capture by upload.')
on conflict (id) do nothing;
