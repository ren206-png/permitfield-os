-- Gate 4 (Quotes & Payments), Phase A, migration 7 of 7: reminder_jobs and
-- reminder_delivery_attempts -- schema/RLS only, per this task's explicit
-- scope. No Inngest function, no scheduler entry point, and no email
-- send call exists anywhere in this migration or this pass.
--
-- No outbox table: GATE_4_FINDINGS.md §5 confirms Inngest is this repo's
-- only queue and there is no separate outbox pattern anywhere in the repo
-- (a repo-wide grep for "outbox" returns zero matches) -- Inngest's own
-- durable step-execution (steps memoize on retry) already serves that
-- role. This migration therefore does NOT add a generic outbox/queue
-- table; `reminder_jobs` below is domain state (what reminders exist and
-- their lifecycle status), which a FUTURE Inngest function (not built in
-- this pass) will poll live via a plain `select ... where status =
-- 'pending' and send_after <= now()` query -- there is no separate
-- dispatch-queue row to write on top of that, matching this repo's
-- existing `lib/inngest/functions/{extract,audit,generate-pdf}.ts`
-- precedent of reading application tables directly rather than a
-- dedicated queue table.
--
-- Email capability does not exist on `main` yet either (§5) -- this schema
-- stores what a reminder should say and to whom, not how it is sent; the
-- actual send mechanism is entirely a future concern.
create type reminder_job_status as enum ('pending', 'sent', 'skipped', 'canceled');
create type reminder_job_kind as enum ('estimate_expiring', 'invoice_due_soon', 'invoice_overdue');

create table reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  kind reminder_job_kind not null,
  -- Polymorphic-by-convention link to the estimate or invoice this
  -- reminder concerns -- same discriminated-column shape as
  -- tax_decisions.source_kind/source_line_item_id (20260806000055), for
  -- the same reason (exactly one of two possible source tables applies,
  -- neither is immutable/append-only enough for a always-safe real FK).
  target_kind text not null check (target_kind in ('estimate', 'invoice')),
  target_id uuid not null,

  status reminder_job_status not null default 'pending',
  -- When this reminder becomes eligible to send. A future poller's query
  -- shape is exactly `where status = 'pending' and send_after <= now()`,
  -- per this migration's header comment.
  send_after timestamptz not null,

  canceled_at timestamptz,
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, id),
  check (status <> 'canceled' or canceled_at is not null),
  check (status = 'canceled' or (canceled_at is null and cancel_reason is null))
);

create index reminder_jobs_org_id_idx on reminder_jobs (org_id);
create index reminder_jobs_status_send_after_idx on reminder_jobs (status, send_after);
create index reminder_jobs_target_idx on reminder_jobs (org_id, target_kind, target_id);

alter table reminder_jobs enable row level security;

-- Read: any org member. Write: any org member may create/cancel a
-- reminder job (this is a scheduling convenience, not one of
-- GATE_4_FINDINGS.md §I item 2's listed consequential-action rights --
-- issuance/void/refund/tax-override/manual-payment-record -- so it does not
-- need billing-manager gating). `status`/timestamps otherwise progress only
-- via the future Inngest poller running as `service_role`, which bypasses
-- RLS -- there is deliberately no authenticated UPDATE path to set
-- status = 'sent' directly (an org member can cancel a pending reminder,
-- but cannot claim one was sent).
create policy reminder_jobs_select on reminder_jobs
  for select to authenticated
  using (is_org_member(org_id));

create policy reminder_jobs_insert on reminder_jobs
  for insert to authenticated
  with check (is_org_member(org_id) and status = 'pending');

-- Cancellation-only update: an authenticated org member may only move a
-- still-pending job to canceled, never touch a job any other way (not
-- sent/skipped -> anything, and not pending -> sent/skipped, which only the
-- future service_role poller does).
create policy reminder_jobs_cancel on reminder_jobs
  for update to authenticated
  using (is_org_member(org_id) and status = 'pending')
  with check (is_org_member(org_id) and status = 'canceled');

grant select, insert, update on reminder_jobs to authenticated;
grant select, insert, update on reminder_jobs to service_role;

-- reminder_delivery_attempts: append-only log of each attempt to actually
-- deliver a reminder (one reminder_job can accumulate multiple attempts,
-- e.g. a retried failed send) -- separate from reminder_jobs' own single
-- current-status column the same way estimate_revisions is separate from
-- estimates' current_revision_id: reminder_jobs holds "where things stand
-- now," this table holds full history of every attempt, and only
-- service_role (the future send worker) ever writes to it.
create type reminder_delivery_channel as enum ('email');
create type reminder_delivery_outcome as enum ('success', 'failure');

create table reminder_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  reminder_job_id uuid not null,

  channel reminder_delivery_channel not null default 'email',
  outcome reminder_delivery_outcome not null,
  error_detail text,

  attempted_at timestamptz not null default now(),

  unique (org_id, id),
  foreign key (org_id, reminder_job_id) references reminder_jobs (org_id, id),
  check (outcome <> 'failure' or error_detail is not null)
);

create index reminder_delivery_attempts_job_id_idx on reminder_delivery_attempts (org_id, reminder_job_id);

alter table reminder_delivery_attempts enable row level security;

-- Read: any org member (visibility into "did our reminder actually go
-- out" is broad-read like everything else in this gate). Write:
-- service_role only -- the future send worker is the only writer, same
-- external/system-actor posture as estimate_acceptances.
create policy reminder_delivery_attempts_select on reminder_delivery_attempts
  for select to authenticated
  using (is_org_member(org_id));

create trigger reminder_delivery_attempts_append_only
  before update or delete on reminder_delivery_attempts
  for each row execute function forbid_update_delete();

grant select on reminder_delivery_attempts to authenticated;
grant select, insert on reminder_delivery_attempts to service_role;
