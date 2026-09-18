-- Failure-notification system (flag PERMITFIELD_FF_FAILURE_NOTIFICATIONS,
-- see lib/flags.ts's isFailureNotificationsEnabled() header comment).
--
-- lib/inngest/client.ts's PermitEventPayloads interface has, since Phase
-- 2/4, described three events -- 'permit/application.extracted' (zodValid),
-- 'permit/application.audited' (audited), 'permit/application.pdf_generated'
-- (succeeded) -- as already firing unconditionally on both success and
-- failure, each one's own comment naming "Phase 5's UI/notifications" as the
-- intended future consumer. This migration ships that consumer's storage:
-- a plain, org-scoped, in-app "needs attention" ledger. The consumer itself
-- (lib/inngest/functions/notify-on-failure.ts) subscribes to those same
-- three events and is the only writer.
--
-- Modeled directly on readiness_checklist_items (20260806000025) --
-- org_id + a composite (org_id, application_id) FK back to
-- permit_applications for the same integrity reason that migration's own
-- header cites (a plain application_id FK can't by itself guarantee the
-- application belongs to org_id; the composite FK against
-- permit_applications' own (org_id, id) can).
--
-- WHAT THIS MIGRATION DOES NOT DO (flagged, not silently decided):
--   - No INSERT/DELETE policy for `authenticated`. Rows are written
--     exclusively by lib/inngest/functions/notify-on-failure.ts via
--     lib/supabase/service-client.ts (service_role, bypasses RLS) -- same
--     "only a trusted background worker writes this ledger" shape as
--     audit_logs (20260806000018), not a table any end-user request ever
--     inserts into directly. service_role already has blanket insert/select
--     via the standing `grant ... to service_role` set established in
--     20260806000015/20260806000031 for other tables of this shape; this
--     migration grants the same explicitly below rather than relying on an
--     ambient default, matching this repo's "GRANT is the enforcement
--     surface, be explicit" discipline.
--   - Only a `read_at` UPDATE is exposed to org members (marking a
--     notification read) -- no other column is client-writable. Judgment
--     call, same class as readiness_checklist_items' "any org member" scope
--     for its own non-override writes: a notification is informational, not
--     a workflow-tier action, so it doesn't need permit_status_tier-style
--     role gating the way transition_permit_status()'s org/submission/
--     jurisdiction_outcome tiers do.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  -- Mirrors the three application_status failure values this system reacts
  -- to (20260806000006, 20260806000016) -- not a foreign key onto
  -- application_status itself, since a notification can outlive the
  -- application moving past the failure it describes.
  kind text not null check (kind in ('extraction_failed', 'audit_failed', 'document_generation_failed')),
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade
);

create index notifications_org_id_idx on notifications (org_id);
-- Partial index: the one live query this table serves is "this org's unread
-- notifications, newest first" (the layout badge count and the /notifications
-- list) -- indexing only the unread rows keeps the index small regardless of
-- how large the read/dismissed backlog grows, same reasoning
-- application_documents' own partial indexes use elsewhere in this schema.
create index notifications_org_id_unread_idx on notifications (org_id, created_at desc) where read_at is null;

alter table notifications enable row level security;

create policy notifications_select on notifications
  for select to authenticated
  using (is_org_member(org_id));

-- Marking read is the one end-user-writable action; is_org_member (not a
-- narrower role) matches this table's read policy above -- see header
-- comment's "informational, not a workflow-tier action" note. The `with
-- check` mirrors `using` exactly so a member can't use this policy to move a
-- row into a different org, though org_id is never actually part of the
-- application-layer UPDATE payload (only read_at is set).
create policy notifications_update on notifications
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

grant select, update on notifications to authenticated;
grant select, insert on notifications to service_role;
