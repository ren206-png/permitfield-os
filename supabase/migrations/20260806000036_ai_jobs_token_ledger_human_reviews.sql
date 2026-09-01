-- Gate AI-1, sub-phase AI-1.1 ("Adapter, router, schema"). Schema half of
-- GATE_AI_1_FINDINGS.md §G's AI-1.1 plan. Additive-only against the existing
-- schema: no existing table, column, or enum value is altered or removed.
--
-- Three new append-only-style ledger tables, siblings to
-- extractions/audits/audit_findings/audit_logs, not a repurposing of any of
-- them -- per GATE_AI_1_FINDINGS.md §E's citation of
-- 20260806000018_lifecycle_rbac_roles_and_audit_log.sql's own header
-- distinction: audit_logs records "what a human (or a background job acting
-- on a human's behalf) did"; extractions/audits record "what the AI
-- produced". These three are the AI-specific siblings for the new AI-1
-- workstream, following the same append-only pattern (SELECT+INSERT-only
-- RLS, forbid_update_delete() trigger reused from 20260806000007) with one
-- deliberate exception: ai_human_reviews needs a mutable decision (pending ->
-- released/rejected), so it follows audit_findings' restricted-update shape
-- (20260806000009's audit_findings_restrict_update()) instead.
--
-- Zero call sites in this migration, deliberately -- same "declared now,
-- enforced at a later call site" pattern every flag in lib/flags.ts and
-- every schema-only migration in the Lifecycle & Compliance Expansion
-- workstream already follows (see e.g. 20260806000021_jurisdiction_sources.sql
-- or 20260806000025_readiness_checklist.sql). No Gemini adapter call,
-- routeAiTask(), or Inngest function writes to these tables yet -- AI-1.2/
-- AI-1.3/AI-1.4 are the sub-phases that add real writers, per
-- GATE_AI_1_FINDINGS.md §G. This migration's existence with zero writers
-- does not change any existing behavior, same reasoning as audit_logs'
-- header comment when it shipped with zero call sites.
--
-- org_id is a direct, NOT NULL column on all three tables (not resolved via
-- a join to permit_applications, unlike extractions/audits) -- per
-- GATE_AI_1_FINDINGS.md §E's own recommendation: a token/cost ledger is
-- exactly the kind of table where a missing/wrong RLS filter is a direct
-- cross-tenant cost leak, and a future task kind might not have an
-- application_id to join through at all (e.g. a purely internal corpus-
-- ingestion job) -- see ai_jobs.related_entity_id below for how that case is
-- handled without forcing a fake application reference.
--
-- Read access to all three tables is gated behind the same elevated-role
-- check as audit_logs (can_read_audit_logs / here, can_read_ai_ledger),
-- because token counts and USD cost are spend data, not routine application
-- content -- a plain 'member'/'permit_coordinator' should not be able to
-- browse an org's AI spend any more than they can browse audit_logs. Which
-- role should be able to *release* a Pro-escalated ai_human_reviews row is
-- an AI-1.4 product decision not yet made (GATE_AI_1_FINDINGS.md's numbered
-- questions did not ask this one directly) -- reusing the audit_logs role
-- list here is a starting point, not a considered final answer; AI-1.4 may
-- need to widen it once the reviewer role is decided.

create type ai_provider as enum ('anthropic', 'gemini', 'voyage');

-- Provisional task-kind list. 'extraction'/'audit' are included for
-- forward-compatibility only -- per GATE_AI_1_FINDINGS.md §A/§G (open
-- question 2, answered with its stated default: the existing
-- lib/ai/extract-permit-data.ts / lib/ai/audit-permit-data.ts call sites are
-- left untouched in AI-1.1), nothing writes an ai_jobs row with either of
-- these two kind values yet. 'assistant'/'classification'/
-- 'checklist_generation' are the new AI-1.3/AI-1.4 capabilities from
-- GATE_AI_1_FINDINGS.md §G that this table is built ahead of. Extensible via
-- `alter type ai_task_kind add value if not exists` in a later migration,
-- same convention as org_role (20260806000018) -- never a value rename.
create type ai_task_kind as enum (
  'extraction',
  'audit',
  'assistant',
  'classification',
  'checklist_generation'
);

create type ai_job_status as enum ('succeeded', 'failed');

create type ai_human_review_status as enum ('pending', 'released', 'rejected');

-- One row per completed model-call attempt (terminal state only -- same
-- "insert once, at the end, with the outcome already known" shape as
-- extractions/audits, not a queued/running/succeeded state machine. In-flight
-- state, if a caller needs it, is the calling Inngest step's own concern;
-- see extract.ts/audit.ts for the precedent of not persisting in-flight
-- state to a durable table at all).
create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind ai_task_kind not null,
  provider ai_provider not null,
  model_id text not null,
  status ai_job_status not null,
  input_token_count int not null check (input_token_count >= 0),
  output_token_count int not null check (output_token_count >= 0),
  error_message text,
  -- Generic back-reference, same shape as audit_logs.entity_type/entity_id --
  -- deliberately not a hard FK to permit_applications, because a future task
  -- kind (e.g. corpus ingestion) may not have an application to point at.
  -- Nullable for that reason; application code is responsible for populating
  -- it whenever a real entity exists, same discipline as audit_logs' own
  -- entity_id (nullable there too, for the same reason).
  related_entity_type text,
  related_entity_id uuid,
  -- Null for a background/service-role-triggered job (e.g. a future
  -- extraction/audit run); populated when a user-initiated call (e.g. the
  -- AI-1.4 assistant) triggers this row directly under the caller's own
  -- session.
  requested_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((status = 'failed') = (error_message is not null))
);

create index ai_jobs_org_id_created_at_idx on ai_jobs (org_id, created_at desc);
create index ai_jobs_related_entity_idx on ai_jobs (related_entity_type, related_entity_id);

-- One row per model call's cost, keyed to the ai_jobs row it came from.
-- Kept separate from ai_jobs (rather than adding cost columns to ai_jobs
-- directly) so AI-1.4's per-org monthly / per-user daily spend-cap
-- aggregation (GATE_AI_1_FINDINGS.md §G) can sum/query this table alone
-- without touching ai_jobs' wider row shape, and so a future job that posts
-- more than one billable call (e.g. a retry that still incurs cost even
-- though the overall job fails) has somewhere to record each charge
-- individually rather than being forced into a single job-level total.
create table ai_token_ledger (
  id uuid primary key default gen_random_uuid(),
  -- Duplicated from ai_jobs.org_id rather than resolved via a join at query
  -- time -- same reasoning as GATE_AI_1_FINDINGS.md §E gave for these sibling
  -- tables generally: a spend ledger with a missing/wrong org filter is a
  -- direct cross-tenant cost leak, so org_id is a first-class column here,
  -- not something callers have to remember to join for.
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references ai_jobs(id) on delete cascade,
  provider ai_provider not null,
  model_id text not null,
  input_token_count int not null check (input_token_count >= 0),
  output_token_count int not null check (output_token_count >= 0),
  -- Integer USD minor units (cents), per this workstream's standing
  -- money-as-integer-minor-units rule. KNOWN LIMITATION, flagged rather than
  -- silently accepted: a single low-volume LLM call frequently costs a small
  -- fraction of one cent, which floors to 0 here. input_token_count/
  -- output_token_count are retained on this same row specifically so an
  -- exact cost can be recomputed at full precision from raw tokens + a
  -- pricing table once GATE_AI_1_FINDINGS.md's still-missing
  -- PERMITFIELD_AI_MODEL_DECISION.md (question 1) supplies real, confirmed
  -- per-token rates -- this column is a rounded convenience aggregate, not
  -- the sole source of truth for spend.
  cost_usd_cents int not null check (cost_usd_cents >= 0),
  created_at timestamptz not null default now()
);

create index ai_token_ledger_org_id_created_at_idx on ai_token_ledger (org_id, created_at desc);
create index ai_token_ledger_job_id_idx on ai_token_ledger (job_id);

-- Pro-escalation human sign-off record (GATE_AI_1_FINDINGS.md §H,
-- PRO_WITHOUT_HUMAN). Unlike ai_jobs/ai_token_ledger, this table's whole
-- purpose is a mutable decision -- pending at creation, then released or
-- rejected by a reviewer -- so it follows audit_findings' restricted-update
-- shape (20260806000009) rather than full append-only: core columns
-- (org_id, job_id, created_at) are immutable after insert, but
-- status/reviewer_user_id/notes/decided_at may transition exactly once from
-- pending to a terminal state.
create table ai_human_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references ai_jobs(id) on delete cascade,
  status ai_human_review_status not null default 'pending',
  reviewer_user_id uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((status = 'pending') = (reviewer_user_id is null)),
  check ((status = 'pending') = (decided_at is null))
);

create index ai_human_reviews_org_id_idx on ai_human_reviews (org_id);
create index ai_human_reviews_job_id_idx on ai_human_reviews (job_id);
create index ai_human_reviews_status_idx on ai_human_reviews (status);

alter table ai_jobs enable row level security;
alter table ai_token_ledger enable row level security;
alter table ai_human_reviews enable row level security;

-- Same elevated-role list as audit_logs' can_read_audit_logs()
-- (20260806000018) -- see this migration's own header for why oversight-role
-- visibility, not plain org membership, is the starting point for spend/
-- review data. plpgsql (not sql) for the same reason as
-- can_read_audit_logs: not strictly required here since no enum value is
-- added in this migration, but kept consistent with that function's own
-- documented reasoning rather than mixing styles across near-identical
-- functions.
create or replace function can_read_ai_ledger(check_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner', 'platform_admin', 'auditor_readonly')
  );
end;
$$;

revoke all on function can_read_ai_ledger(uuid) from public;
grant execute on function can_read_ai_ledger(uuid) to authenticated;

create policy ai_jobs_select on ai_jobs
  for select to authenticated
  using (can_read_ai_ledger(org_id));

create policy ai_token_ledger_select on ai_token_ledger
  for select to authenticated
  using (can_read_ai_ledger(org_id));

create policy ai_human_reviews_select on ai_human_reviews
  for select to authenticated
  using (can_read_ai_ledger(org_id));

-- No INSERT policy for `authenticated` on ai_jobs/ai_token_ledger --
-- deliberately, same as extractions/audits (20260806000007/20260806000009):
-- these are written by background jobs under service_role only, granted
-- separately below. RLS default-denies INSERT for `authenticated` with no
-- matching policy, regardless of the table-level GRANT.
create trigger ai_jobs_append_only
  before update or delete on ai_jobs
  for each row execute function forbid_update_delete();

create trigger ai_token_ledger_append_only
  before update or delete on ai_token_ledger
  for each row execute function forbid_update_delete();

-- ai_human_reviews: an elevated-role org member may transition their own
-- reviewer_user_id in, exactly once, from pending to a terminal status.
-- with check prevents forging another user's reviewer_user_id, same
-- reasoning as audit_logs_insert's actor_user_id = auth.uid() check
-- (20260806000018).
create policy ai_human_reviews_decide on ai_human_reviews
  for update to authenticated
  using (can_read_ai_ledger(org_id))
  with check (can_read_ai_ledger(org_id) and reviewer_user_id = auth.uid());

create or replace function ai_human_reviews_restrict_update()
returns trigger
language plpgsql
as $$
begin
  if OLD.id is distinct from NEW.id
     or OLD.org_id is distinct from NEW.org_id
     or OLD.job_id is distinct from NEW.job_id
     or OLD.created_at is distinct from NEW.created_at
  then
    raise exception 'ai_human_reviews is append-only except for status/reviewer_user_id/notes/decided_at';
  end if;
  if OLD.status <> 'pending' then
    raise exception 'ai_human_reviews.status may only transition once, away from pending';
  end if;
  return NEW;
end;
$$;

create trigger ai_human_reviews_restrict_update_trigger
  before update on ai_human_reviews
  for each row execute function ai_human_reviews_restrict_update();

create trigger ai_human_reviews_no_delete
  before delete on ai_human_reviews
  for each row execute function forbid_delete();

-- Table-level grants. Following 20260806000011's explicit-grants-only
-- convention: `authenticated` gets exactly the columns/operations its RLS
-- policies actually allow (SELECT on all three, UPDATE additionally on
-- ai_human_reviews so the trigger's specific error fires instead of a
-- generic permission-denied, same reasoning as audit_logs' grant comment) --
-- never a blanket grant.
grant select on ai_jobs to authenticated;
grant select on ai_token_ledger to authenticated;
grant select, update on ai_human_reviews to authenticated;

-- service_role: narrow, scoped to what a future writer will actually need
-- (INSERT on all three; ai_human_reviews additionally needs SELECT/INSERT
-- since a background job is expected to create the initial pending row --
-- see this migration's header). No background job calls any of this yet
-- (this migration ships zero call sites), but per 20260806000015's own
-- documented lesson (service_role has BYPASSRLS, not a table-level
-- privilege bypass -- it needs its own explicit GRANT just like every other
-- role), granting this now avoids a guaranteed "permission denied for
-- table ai_jobs" the moment AI-1.2/AI-1.3 adds the first real writer.
grant select, insert on ai_jobs to service_role;
grant select, insert on ai_token_ledger to service_role;
grant select, insert on ai_human_reviews to service_role;

-- Close the same TRUNCATE gap 20260806000033 closed for the original seven
-- append-only tables, proactively rather than waiting for a future audit to
-- rediscover it: Supabase grants service_role TRUNCATE on every public-schema
-- table by platform default (SERVICE_ROLE_GRANTS_FINDINGS.md), and none of
-- the row-level triggers above (forbid_update_delete /
-- ai_human_reviews_restrict_update / forbid_delete) fire on TRUNCATE --
-- only a row-level UPDATE/DELETE. Revoking here, in the same migration that
-- creates these tables, means there is no window where the gap existed and
-- was merely undiscovered.
revoke truncate on ai_jobs from service_role;
revoke truncate on ai_token_ledger from service_role;
revoke truncate on ai_human_reviews from service_role;
