-- Maple Ridge's building permit fees, registered as a source so its
-- Commercial Tenant Improvement fee schedule can be published
-- (publish_fee_schedule_version, 097). Same pattern as 099-107.
--   * Maple Ridge Fees & Charges Bylaw No. 7575-2019, consolidated for
--     reference June 30, 2026. Schedule "A" (effective September 1, 2025,
--     Amending Bylaw 8043-2025), Building Fees: application fee $602.55 per
--     permit (other than single detached and duplex), $103.00 per unit, and
--     the building permit fee on market value -- $154.50 for the first
--     $5,000, then $14.16 / $13.49 / $10.82 / $10.30 / $10.04 per $1,000 by band.
-- mapleridge.ca serves the PDF to the automated check and its robots.txt
-- allows the path.
--
-- Rollback (valid while no source_revisions reference it):
--   delete from jurisdiction_sources where id = '00000000-0000-0000-0005-000000000014';

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-000000000014', '00000000-0000-0000-0001-00000000000a', 'fee_schedule',
   'https://www.mapleridge.ca/media/file/fees-charges-consolidated-bylaw-no-7575-2019',
   '2026-11-01', 'pending_review', 'Fees & Charges Bylaw No. 7575-2019 (consolidated June 30, 2026): Schedule A building fees, effective September 1, 2025.')
on conflict (id) do nothing;
