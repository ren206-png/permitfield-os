-- Gate 5, sub-phase 5.3 hardening (post-ship, per Ren's explicit "1-4
-- matters to me please work on it" instruction). Additive only, per this
-- repo's standing migration convention.
--
-- notification_pending_events: the durable queue backing the new
-- digest/batching behavior for lib/inngest/functions/notify.ts. Before this
-- migration, every one of the four lifecycle events notify.ts subscribes to
-- sent its own separate email immediately -- an application that extracted,
-- audited, and generated documents within the same minute would email every
-- org member three separate times. This table lets notify.ts record each
-- event's already-derived content immediately (never losing an event to a
-- crash or a debounce window's own "only the latest event survives"
-- limitation -- see this migration's own note on that below), while a new,
-- separate, debounced function (lib/inngest/functions/notify.ts's
-- permitNotifyFlush) reads everything still pending for one application
-- once things go quiet and sends ONE combined email per recipient.
--
-- WHY A SEPARATE TABLE, NOT INNGEST'S OWN debounce/batchEvents CONFIGS
-- ALONE: Inngest's `debounce` replaces the eventually-executed run's
-- triggering event with only the LATEST matching event received -- every
-- earlier event's own data is discarded by debounce itself, confirmed via
-- node_modules/inngest/components/InngestFunction.d.ts's own doc comment
-- ("the triggering event is replaced with the latest event received"). A
-- debounced function reading only its own triggering event would see the
-- pdf_generated event and lose the extracted/audited ones that fired
-- moments earlier. This table is the actual source of truth for "what
-- happened and needs to be sent"; the debounced function
-- (permitNotifyFlush) only uses its OWN triggering event
-- ('permit/notification.queued') to learn WHICH applicationId to look up,
-- never to learn WHAT to send. `batchEvents` was also considered and
-- rejected -- see notify.ts's own header comment for why (unconfirmed
-- cross-trigger-name behavior, and documented incompatibility with
-- `idempotency`/`rateLimit`/`cancel`/`priority`).
--
-- DELIBERATE EXCEPTION to this codebase's append-only-ledger convention
-- (notification_log, drawing_findings_rejected, ai_jobs, etc.): this table
-- gets an UPDATE grant and NO forbid_update_delete() trigger. It is
-- transient coordination state, not a permanent record -- once
-- permitNotifyFlush has included a row in a sent digest, that row's job is
-- done, marked via `flushed_at`, not preserved forever. notification_log
-- (unchanged, still append-only) remains the actual permanent record of
-- what was sent to whom; this table only tracks "is this occurrence still
-- waiting to be included in a digest."
create table notification_pending_events (
  id uuid primary key default gen_random_uuid(),
  -- Direct column, not resolved via a join -- same cross-tenant-leak
  -- reasoning as notification_log.org_id (20260806000048...sql), even
  -- though (like notification_log) this table has no SELECT policy for
  -- `authenticated` to filter.
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references permit_applications(id) on delete cascade,
  -- Same one-directional relationship to event_kind as
  -- notification_log.application_document_id -- see that column's own
  -- comment (20260806000048...sql) for why this is deliberately NOT a
  -- bidirectional CHECK (self-contradictory with `on delete set null`).
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
  check (
    event_kind = 'drawing_review_completed' or application_document_id is null
  ),
  -- Pre-composed by notify.ts at enqueue time (deriveNotificationContent()'s
  -- output, with the application deep link already appended to `body`) --
  -- this table stores exactly what would have been emailed immediately
  -- pre-digest, not a re-derivable pointer back to the source event. This
  -- keeps permitNotifyFlush's own composeDigestEmail() a pure
  -- string-concatenation step over already-finished content, with zero
  -- second DB round-trip back to permit_applications/permit_types at flush
  -- time.
  subject text not null,
  body text not null,
  -- NULL = still waiting to be included in a digest send. Non-null = the
  -- timestamp permitNotifyFlush actually included this row in a sent (or
  -- attempted-and-logged) digest. Not a boolean: the timestamp itself is
  -- useful for debugging an unexpectedly slow flush.
  flushed_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_pending_events_org_id_idx on notification_pending_events (org_id);
-- The one query permitNotifyFlush actually runs: "every still-pending row
-- for this applicationId" -- a partial index (flushed_at is null) keeps
-- this cheap indefinitely even as flushed rows accumulate, since a flushed
-- row never needs to satisfy this lookup again.
create index notification_pending_events_pending_by_application_idx
  on notification_pending_events (application_id)
  where flushed_at is null;

alter table notification_pending_events enable row level security;

-- Zero policies -- default-deny for `authenticated`, same as
-- notification_log: no UI reads or writes this table, it is purely internal
-- coordination state between two Inngest functions.

-- service_role: SELECT + INSERT + UPDATE, deliberately including UPDATE
-- (unlike every append-only sibling table in this workstream) -- see this
-- migration's own header comment on why this table is the deliberate
-- exception to the append-only convention. No DELETE: a flushed row is left
-- in place rather than deleted, so "how many events got digested into this
-- send" stays inspectable; nothing in this sub-phase needs the table kept
-- small, and adding a retention sweep is a future operational concern, not
-- a correctness one.
grant select, insert, update on notification_pending_events to service_role;

-- Close the same Supabase-platform-default service_role TRUNCATE gap this
-- workstream's other new tables close proactively (20260806000033's
-- lesson). Unlike this table's append-only siblings, there is no
-- row-level trigger here to intercept a TRUNCATE -- RLS's blanket denial for
-- `authenticated` doesn't apply to service_role at all, so this revoke is
-- the only backstop.
revoke truncate on notification_pending_events from service_role;

-- Close the analogous DELETE gap for service_role, and the SELECT/INSERT/
-- UPDATE/DELETE gap for `authenticated` (zero policies above means
-- default-deny is meant to be total for that role), for the same reason
-- 20260806000044_org_subscriptions_revoke_authenticated_write.sql (already
-- on main) and this workstream's own 20260806000046/20260806000048/
-- 20260806000049 close their own gaps: the grants above assumed omitting a
-- grant is equivalent to denying it, but the Supabase CLI seeds Postgres'
-- per-schema default privileges (pg_default_acl) at `supabase start`/`db
-- reset` time from the CLI/Postgres image, not from this repo, so an
-- unpinned CLI version (CI's `supabase/setup-cli@v1 version: latest`) is
-- not guaranteed to leave a never-granted privilege closed. Revoke
-- explicitly instead of relying on that implicit, CLI-version-dependent
-- default.
revoke delete on notification_pending_events from service_role;
revoke select, insert, update, delete on notification_pending_events from authenticated;
