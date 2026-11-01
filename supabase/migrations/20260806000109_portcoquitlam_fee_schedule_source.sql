-- Port Coquitlam's 2026 building permit fees, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097). Same pattern as 099-108.
--   * Fees and Charges Bylaw, 2025, No. 4415 -- in effect January 1, 2026;
--     adopted November 25, 2025 (later amendments 4439 and 4446 touch other
--     schedules). Schedule E, Table 1 Building Permit Fees: a fee at
--     application AND the same fee before issuance -- $120 up to $5,000;
--     0.8% + $20 to $50,000; 0.55% + $150 to $500,000; 0.45% + $750 above.
-- portcoquitlam.ca serves the PDF to the automated check and its robots.txt
-- allows the path.
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000015';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000015', '00000000-0000-0000-0001-000000000009', 'fee_schedule',
   'https://www.portcoquitlam.ca/media/file/4415-fees-and-charges-bylawpdf',
   '2026-11-01', 'pending_review', 'Fees and Charges Bylaw, 2025, No. 4415 (in effect January 1, 2026; adopted November 25, 2025): Schedule E Table 1 building permit fees at application and before issuance.')
on conflict (id) do nothing;
