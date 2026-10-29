-- Official fee schedules for Calgary and Toronto, registered as sources so
-- their fee schedules can be published (publish_fee_schedule_version, 097,
-- requires a PUBLISHED revision of a source in the same jurisdiction).
--
-- Content only: two jurisdiction_sources rows, pending review like 080/083's.
-- The source registry (PERMITFIELD_FF_SOURCE_REGISTRY) captures them on the
-- next check; an admin publishes the capture in /admin/sources, then the fee
-- schedule in /admin/rule-sets.
--   * Calgary: 2026 Building & Trade Permit Fee Schedule (R2026-02), PDF.
--   * Toronto: Building Permit Fees page (fees effective January 1, 2026,
--     date modified June 19, 2026).
-- Vancouver's fee schedule is not registered: vancouver.ca refuses automated
-- requests (HTTP 403, 2026-10-29), so a source check could never capture it.
--
-- Rollback (valid while no source_revisions reference them):
--   delete from jurisdiction_sources where id in
--     ('00000000-0000-0000-0005-00000000000d', '00000000-0000-0000-0005-00000000000e');

insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at, verification_status, notes)
values
  ('00000000-0000-0000-0005-00000000000d', '00000000-0000-0000-0001-000000000002', 'fee_schedule',
   'https://www.calgary.ca/content/dam/www/pda/pd/documents/fees/building-and-trade-permit-fee-schedule.pdf',
   '2026-10-29', 'pending_review', '2026 Building & Trade Permit Fee Schedule (R2026-02): processing fee, base fee per $1,000 of construction value, Safety Codes Council fee.'),
  ('00000000-0000-0000-0005-00000000000e', '00000000-0000-0000-0001-000000000001', 'fee_schedule',
   'https://www.toronto.ca/services-payments/building-construction/building-permit/before-you-apply-for-a-building-permit/building-permit-fees/',
   '2026-10-29', 'pending_review', 'Building Permit Fees, effective January 1, 2026: interior alteration rates per m2 by occupancy group, minimum fee, Zoning Certificate fee.')
on conflict (id) do nothing;
