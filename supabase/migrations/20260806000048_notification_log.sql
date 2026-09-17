-- Gate 5, sub-phase 5.3 (GATE_5_FINDINGS.md §K/§F/§J.4). Additive only,
-- per this repo's standing migration convention: no existing table,
-- column, or enum value is altered or removed.
--
-- notification_log: one row per (recipient, lifecycle event) send attempt
-- made by the new notification-sending Inngest subscriber
-- (lib/inngest/functions/notify.ts), which fans in from FOUR existing
-- events -- 'permit/application.extracted' / '.audited' / '.pdf_generated'
-- / '.drawing_reviewed' -- every one of which was, until this sub-phase,
-- explicitly documented as having "no subscriber... yet" (lib/inngest/
-- client.ts's own comments). §F confirmed zero notification infrastructure
-- existed anywhere in this repo before this migration -- no
-- notifications/email_log/notification_queue table of any shape.
--
-- SHAPE: mirrors the simpler insert-only, RLS-default-deny
-- drawing_findings_rejected/ai_findings_rejected precedent
-- (20260806000046/20260806000010), not the richer SELECT-gated-for-
-- elevated-roles ai_jobs ledger shape (20260806000036) -- no UI or ops
-- read-path consumes this table yet ("declare ahead of its consumer",
-- same discipline as every flag/column/event in this workstream). Unlike
-- ai_jobs (spend/cost data, gated behind can_read_ai_ledger()),
-- notification_log is closer to an operational delivery log than a
-- tenant-facing ledger -- if a future phase builds a "notification
-- history" UI, that's the point to add a can_read_notification_log()
-- SELECT policy, not to guess at its shape now.
--
-- SCOPE: internal/staff (org_members) recipients only -- see
-- lib/notifications/recipients.ts's header comment for why the external/
-- client-portal recipient path is deliberately out of scope here.
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  -- Direct column, not resolved via a join -- same "a table where a
  -- missing/wrong filter is a direct cross-tenant leak" reasoning as
  -- ai_jobs.org_id (20260806000036), even though this table currently has
  -- no SELECT policy of any kind to filter.
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references permit_applications(id) on delete cascade,
  -- Only populated for event_kind = 'drawing_review_completed' -- a
  -- drawing review is scoped to one application_documents row, not the
  -- whole application (mirrors drawing_reviews.application_document_id,
  -- 20260806000045). ON DELETE SET NULL, not CASCADE, same reasoning as
  -- drawing_findings_rejected.application_document_id (20260806000046):
  -- this log row documents a notification that was actually sent: it must
  -- not disappear just because the referenced document was later
  -- archived/replaced.
  application_document_id uuid references application_documents(id) on delete set null,
  event_kind text not null check (
    event_kind in (
      'extraction_completed',
      'extraction_failed',
      'audit_completed',
      'pdf_generated',
      'pdf_generation_failed',
      'drawing_review_completed'
    )
  ),
  -- Free CHECK constraint, not a Postgres enum type -- deliberately, so a
  -- future sixth/seventh event kind (e.g. a real
  -- 'permit/application.review_confirmed' notification) is a plain
  -- `alter table ... drop constraint / add constraint` rather than the
  -- `alter type ... add value` ceremony (which also can't be used inside
  -- the same transaction that adds the value, per 20260806000045's own
  -- comment on ai_task_kind). This table has no other column that would
  -- benefit from the enum's storage/comparison efficiency at the volumes
  -- this workstream expects.
  --
  -- One-directional, NOT the bidirectional `(event_kind =
  -- 'drawing_review_completed') = (application_document_id is not null)`
  -- shape used elsewhere in this migration's own design notes below --
  -- deliberately relaxed after discovering that shape is self-contradictory
  -- with application_document_id's own `on delete set null` immediately
  -- above: when the referenced application_documents row is deleted, the FK
  -- fires an UPDATE that nulls application_document_id on THIS row, and a
  -- bidirectional check would then reject that very UPDATE for any
  -- drawing_review_completed row (verified live: `on delete set null`
  -- silently becomes "the DELETE itself fails" the moment a
  -- drawing_review_completed row references it -- caught by
  -- supabase/tests/notification_log.test.sql's own ON DELETE SET NULL
  -- check). This direction still forbids the actually-wrong case (a
  -- non-drawing-review event carrying a document id it has no business
  -- having); it just no longer re-forbids a drawing-review row's id being
  -- nulled out later by the FK. The insert-time guarantee (a
  -- drawing_review_completed row is always written WITH a document id) is
  -- instead enforced the same way every other cross-field invariant in
  -- lib/inngest/functions/notify.ts's own call site already is: by
  -- lib/notifications/content.ts's deriveNotificationContent(), the single
  -- code path that ever populates this column.
  check (
    event_kind = 'drawing_review_completed' or application_document_id is null
  ),
  -- Only 'email' exists today (Resend, per §J.4) -- a plain CHECK, not an
  -- enum, same "free text/CHECK now, decide the fixed list later"
  -- reasoning as drawing_category (20260806000045): no SMS/webhook-out
  -- provider has been chosen yet (§F), and this column just needs to not
  -- block that future decision.
  channel text not null default 'email' check (channel = 'email'),
  -- Nullable: the recipient may have been deleted from auth.users between
  -- send time and any later read of this table (there is none yet, but the
  -- column should still degrade gracefully). ON DELETE SET NULL, not
  -- CASCADE, for the same "the log entry documents history, it must
  -- outlive the referenced row" reasoning as application_document_id
  -- above -- recipient_email (below) is denormalized specifically so the
  -- record of WHO was actually notified survives independent of this FK.
  recipient_user_id uuid references auth.users(id) on delete set null,
  -- Denormalized -- same "keep the actual delivery address independent of
  -- the live auth.users row" reasoning as client_access_tokens'
  -- recipient_email_display in the second Supabase project.
  recipient_email text not null,
  status text not null check (status in ('sent', 'failed')),
  -- Only 'resend' exists today -- same free-CHECK reasoning as `channel`
  -- above, for the same reason (no second provider chosen yet).
  provider text not null default 'resend' check (provider = 'resend'),
  -- Resend's own email id (CreateEmailResponseSuccess.id) -- populated only
  -- when status = 'sent', useful for support/debugging against Resend's
  -- own dashboard/logs. Not enforced by a CHECK the way error_message is
  -- below: a 'sent' row missing this would still be a real send (Resend's
  -- response shape not changing this table's own correctness guarantee),
  -- whereas a 'failed' row is only meaningfully explainable with a
  -- message.
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  -- Same "the state pair moves together" CHECK shape as ai_jobs'
  -- ((status = 'failed') = (error_message is not null)) (20260806000036).
  check ((status = 'failed') = (error_message is not null))
);

create index notification_log_org_id_idx on notification_log (org_id);
create index notification_log_application_id_idx on notification_log (application_id);

alter table notification_log enable row level security;

-- Zero policies -- default-deny for `authenticated`, same as
-- drawing_findings_rejected/ai_findings_rejected (no UI reads this table
-- yet; adding a real SELECT policy is a future phase's concern once one
-- exists, not something to guess at now).
--
-- Append-only, mirroring every other lifecycle-record table in this
-- codebase, even though there is currently no SELECT/UPDATE/DELETE grant
-- of any kind to trigger against -- if a future migration adds broader
-- grants (e.g. an `authenticated` SELECT policy for a notification-history
-- UI), this trigger is already in place rather than being a gap
-- discovered afterward.
create trigger notification_log_append_only
  before update or delete on notification_log
  for each row execute function forbid_update_delete();

-- Table-level grants, mirroring drawing_findings_rejected/
-- ai_findings_rejected exactly (20260806000046/20260806000010):
-- service_role is the only writer that exists (lib/inngest/functions/
-- notify.ts), and gets INSERT only, not SELECT -- there is no code path in
-- this sub-phase that needs to read this table back (Inngest's own
-- idempotency/step memoization is what prevents duplicate sends within one
-- run, not a query against this table -- see notify.ts's own header
-- comment). `authenticated` gets no grant at all: unlike
-- drawing_findings_rejected (whose sibling drawing_findings does have an
-- authenticated-facing table), nothing in this workstream gives org members
-- their own view of this table yet.
grant insert on notification_log to service_role;

-- Close the Supabase-platform-default service_role TRUNCATE grant in the
-- same migration that creates this table (20260806000033's lesson, applied
-- proactively here rather than by a future audit) -- TRUNCATE bypasses
-- every row-level trigger above.
revoke truncate on notification_log from service_role;

-- Close the analogous SELECT gap, same root cause and same fix shape as
-- 20260806000044_org_subscriptions_revoke_authenticated_write.sql (already
-- on main) and this migration's own sibling
-- 20260806000046_drawing_findings_rejected.sql: the Supabase CLI seeds
-- Postgres' per-schema default privileges (pg_default_acl for role
-- postgres, schema public) at `supabase start`/`db reset` time, before any
-- of this repo's own migrations run, and that seeding is versioned with the
-- CLI/Postgres image rather than this repo -- `supabase/setup-cli@v1
-- version: latest` in CI is not guaranteed to match whatever a given local
-- install happens to have. The grant comment above ("gets INSERT only, not
-- SELECT") assumed omitting a grant is equivalent to denying it; per
-- SERVICE_ROLE_GRANTS_FINDINGS.md, service_role holds the full privilege
-- set on every public-schema table by platform default, independent of
-- this repo's own narrower grants, so omission alone does not close the
-- gap in every environment. Revoke explicitly instead of relying on that
-- implicit, CLI-version-dependent default.
revoke select on notification_log from service_role;
