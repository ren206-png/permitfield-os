-- Lifecycle & Compliance Expansion, Phase 1.3: "Permit applications + status
-- state machine + status history" (flag permitfield_applications). Additive
-- only against every prior migration: no existing column, row, or enum
-- value is renamed, retyped, or removed.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW ENUM/COLUMN INSTEAD OF EXTENDING `application_status` (rule 8
-- stop-and-ask, resolved with the user; see PHASE_0_FINDINGS.md SS L for the
-- full citation-backed writeup):
--
-- `permit_applications.status` (`application_status`, 20260806000006, later
-- widened by 20260806000012/20260806000016) is a live 13-value enum
-- describing the AI document-processing pipeline's own progress (draft ->
-- uploading -> extracting -> ... -> submitted). It is written exclusively by
-- lib/inngest/functions/{extract,audit,generate-pdf}.ts and
-- app/api/applications/[id]/{confirm-review,submit}/route.ts. Master prompt
-- SS3.5's 16-status permit-lifecycle machine (intake through closed) is a
-- different concept: it describes the *permit's* real-world progress through
-- the org's own workflow and the issuing jurisdiction, which exists whether
-- or not this system ever runs an AI extraction on it. The two machines share
-- exactly one word, 'submitted', and even that word means related-but-
-- distinct facts (SS L.2): the pipeline's 'submitted' is a contractor's
-- "I filed this with the authority" confirmation; the new machine's
-- 'submitted' is the same real-world fact viewed from the lifecycle side.
-- Reusing `status`/`application_status` for both would have required either
-- (a) retrofitting 13 existing values into a fundamentally different
-- 16-state shape (a rename/retype, forbidden by the additive-only rule and a
-- breaking change to three background jobs and two routes), or (b) silently
-- conflating two different claims the system makes about an application --
-- exactly the kind of unverified-claim risk this system's own audit engine
-- exists to prevent (SS0.2). So: a new column, `permit_status`
-- (`permit_status_enum`), living alongside `status` on the same table,
-- untouched by any of the pipeline's existing writers.
--
-- THE ONE PLACE THE TWO MACHINES ARE DB-ENFORCED TO AGREE (SS L.3(b)):
-- transition_permit_status() below refuses to advance `permit_status` to
-- 'submitted' unless `status` (the pipeline column) has *already* reached its
-- own 'submitted' value. This is the one explicit, DB-enforced gate between
-- the two machines; no other cross-machine coupling exists in this gate --
-- there is no auto-advance in either direction (SS L.3(a)), and `status`
-- continues to drive 100% of today's contractor-facing UI unchanged
-- (components/status-badge.tsx, app/(app)/applications/**) (SS L.3(c)).
-- `permit_status` drives no UI in this gate; it ships as infrastructure with
-- zero call sites, same "schema exists, nothing reads it yet" pattern this
-- repo has used since Phase 1.0 (audit_logs, jurisdiction_sources).
-- ---------------------------------------------------------------------------
--
-- THE 16 STATUSES AND THEIR THREE ROLE TIERS (design decisions made jointly
-- with the user during Gate 1.3 planning; full narrative in
-- docs/STATUS_TRANSITIONS.md):
--   org        (6): intake, requirements_review, collecting_documents,
--                    internal_review, ready_to_submit, withdrawn -- the org's
--                    own work, full existing permit_applications-write role
--                    set, self-attestation is correct here.
--   submission  (2): submitted, under_municipal_review -- the handoff point;
--                    permit_manager and above only (someone accountable owns
--                    the handoff).
--   jurisdiction_outcome (8): approved, rejected, issued, expired, closed,
--                    plus three correction/resubmission states this
--                    migration adds to complete the spec's 16-state count --
--                    revision_requested, resubmitted, appeal_filed.
--                    permit_manager/permit_coordinator and above only: these
--                    record an external decision, not an org action: letting
--                    applicant_contractor set 'issued' would make it an
--                    unauditable self-attestation.
-- The exact 3 correction/resubmission state names (revision_requested,
-- resubmitted, appeal_filed) were left to this migration's judgment by the
-- user ("plus any correction/resubmission states in the 16") -- flagged here
-- per rule 8 as a judgment call, not a spec citation, same as this repo
-- flags every other product-decision (non-DB-citation) row in
-- lib/authz/index.ts. See docs/STATUS_TRANSITIONS.md for the reasoning
-- behind each one and the full transition diagram.
--
-- Role tiers are enforced INSIDE transition_permit_status() below, not via a
-- new RLS policy on permit_applications (explicit user instruction: the
-- function is the only sanctioned write path for `permit_status`, so that's
-- where the rule belongs, and the rejection message can name the required
-- role/tier). This does NOT touch permit_applications' existing RLS at all
-- -- RLS still allows `authenticated` to reach an UPDATE statement against
-- this table. What actually forecloses the bypass is narrower and blunter:
-- a column-level privilege revoke (`revoke update (permit_status) on
-- permit_applications from authenticated`, at the bottom of this file,
-- added after Gate 1.3 review) means a direct `update permit_applications
-- set permit_status = ...` from `authenticated` fails immediately with
-- insufficient_privilege (42501) -- it never reaches RLS evaluation at all,
-- since Postgres checks column-level grants first. transition_permit_status
-- () is unaffected (SECURITY DEFINER, executes as the function owner, not
-- as `authenticated`). See this migration's own tests for the direct-UPDATE
-- probe that proves this.
create type permit_status_enum as enum (
  'intake',
  'requirements_review',
  'collecting_documents',
  'internal_review',
  'ready_to_submit',
  'withdrawn',
  'submitted',
  'under_municipal_review',
  'revision_requested',
  'resubmitted',
  'appeal_filed',
  'approved',
  'rejected',
  'issued',
  'expired',
  'closed'
);

-- NOT NULL DEFAULT 'intake' (not nullable): every application, existing or
-- new, gets an explicit starting point in the new machine the moment this
-- column exists -- same "new column, sane default, applies retroactively"
-- pattern permit_applications.status itself already used
-- (20260806000006 L24: `status application_status not null default
-- 'draft'`). This is additive (a new column with a default is not a
-- rename/retype of anything existing) and does not change what `status`
-- means or does. The two existing seed fixture rows (supabase/seed.sql
-- PART 2) get 'intake' via this default; they do NOT get a synthesized
-- application_status_history row for it (see
-- seed_permit_status_history() below for why: a history row asserts a
-- witnessed transition, and these two rows never went through one).
--
-- project_id: nullable in THIS migration on purpose (explicit user
-- decision) -- permit_applications predates the `projects` table
-- (20260806000019) entirely, and every existing row (including both seed
-- fixtures, confirmed via PHASE_0_FINDINGS.md SS L.4) has no project to
-- link to yet. Required at the application layer for all NEW rows going
-- forward starting this gate; a dated follow-up migration in this same
-- gate (20260806000023) backfills every remaining orphan and then sets
-- NOT NULL. Composite FK, same cross-org-prevention pattern as
-- 20260806000019/20260806000020: `(org_id, project_id) references
-- projects (org_id, id)`, which requires `unique (org_id, id)` on
-- permit_applications itself (added below) so
-- application_status_history can reference this table the same way.
--
-- Evidence columns for jurisdiction-outcome states (permit_number,
-- decision_date, decision_document_id): added now, NOT enforced in this
-- gate (explicit user instruction -- "add the columns now so the later
-- constraint is additive"). No CHECK constraint requires these to be
-- non-null for 'approved'/'issued'/etc. yet; a future gate is expected to
-- add one once the application layer actually collects this evidence.
-- decision_document_id is a plain (non-composite) FK to
-- application_documents(id) -- application_documents has no org_id column
-- of its own anywhere in this schema (its RLS resolves org membership by
-- joining through permit_applications, 20260806000006 L75-105), so there
-- is no `(org_id, id)` pair on that table for a composite FK to reference;
-- a plain FK is the existing, consistent shape for anything pointing at
-- application_documents.
alter table permit_applications
  add column permit_status permit_status_enum not null default 'intake',
  add column project_id uuid,
  add column permit_number text,
  add column decision_date date,
  add column decision_document_id uuid references application_documents(id) on delete set null;

alter table permit_applications
  add constraint permit_applications_org_id_id_key unique (org_id, id);

alter table permit_applications
  add constraint permit_applications_project_id_fkey
  foreign key (org_id, project_id) references projects (org_id, id);

create index permit_applications_project_id_idx on permit_applications (org_id, project_id);
create index permit_applications_permit_status_idx on permit_applications (org_id, permit_status);

-- Single typed source of truth for which (from_status, to_status) pairs are
-- legal, mirrored in lib/permit-status/transitions.ts's
-- PERMIT_STATUS_TRANSITIONS map (see that file's header comment for the
-- cross-check discipline -- same "both implementations must agree" pattern
-- lib/jurisdictions/staleness.ts established in Phase 1.2). A lookup table,
-- not a hardcoded CASE inside the RPC, so the legal-move set is inspectable
-- and testable independent of transition_permit_status()'s other logic (role
-- checks, idempotency, the cross-machine 'submitted' gate) -- see
-- docs/STATUS_TRANSITIONS.md for the full diagram and the reasoning behind
-- every edge. `from_status` is nullable: the one `(null, 'intake')` row
-- documents the only legal "starting" transition, exercised by
-- seed_permit_status_history() below, not by application code calling
-- transition_permit_status() directly (there is no legal from-state to
-- request 'intake' from once a row already exists).
create table permit_status_transitions (
  from_status permit_status_enum,
  to_status permit_status_enum not null,
  unique nulls not distinct (from_status, to_status)
);

insert into permit_status_transitions (from_status, to_status) values
  (null, 'intake'),
  ('intake', 'requirements_review'),
  ('intake', 'withdrawn'),
  ('requirements_review', 'collecting_documents'),
  ('requirements_review', 'withdrawn'),
  ('collecting_documents', 'internal_review'),
  ('collecting_documents', 'withdrawn'),
  ('internal_review', 'ready_to_submit'),
  ('internal_review', 'collecting_documents'),
  ('internal_review', 'withdrawn'),
  ('ready_to_submit', 'submitted'),
  ('ready_to_submit', 'collecting_documents'),
  ('ready_to_submit', 'withdrawn'),
  ('submitted', 'under_municipal_review'),
  ('under_municipal_review', 'revision_requested'),
  ('under_municipal_review', 'approved'),
  ('under_municipal_review', 'rejected'),
  ('under_municipal_review', 'issued'),
  ('revision_requested', 'collecting_documents'),
  ('revision_requested', 'resubmitted'),
  ('revision_requested', 'withdrawn'),
  ('resubmitted', 'under_municipal_review'),
  ('approved', 'issued'),
  ('approved', 'expired'),
  ('rejected', 'appeal_filed'),
  ('rejected', 'closed'),
  ('appeal_filed', 'under_municipal_review'),
  ('appeal_filed', 'approved'),
  ('appeal_filed', 'rejected'),
  ('appeal_filed', 'closed'),
  ('issued', 'expired'),
  ('issued', 'closed'),
  ('expired', 'closed');
-- 'closed' and 'withdrawn' have no outgoing rows: both are terminal by
-- design (docs/STATUS_TRANSITIONS.md).

alter table permit_status_transitions enable row level security;

-- Reference data, same global-readability shape as jurisdictions/authorities
-- (20260806000004) and jurisdiction_sources (20260806000021): every
-- authenticated user, any org, needs to be able to introspect the legal move
-- set (e.g. to grey out an illegal action in a future UI) -- there is no
-- org_id on this table at all. No INSERT/UPDATE/DELETE policy for
-- `authenticated` -- this table is seeded once by this migration; changing
-- the legal transition set is a schema change (a new migration), not a
-- runtime action.
create policy permit_status_transitions_select on permit_status_transitions
  for select to authenticated
  using (true);

grant select on permit_status_transitions to authenticated, service_role;

-- Pure SQL, immutable (no table access, no now()) -- mirrors
-- lib/permit-status/transitions.ts's PERMIT_STATUS_TIER map exactly. Used by
-- transition_permit_status() below to decide which role tier a transition's
-- *destination* status requires, and exposed standalone (not inlined into
-- the RPC) so a future read-only UI can ask "what tier is this status" (e.g.
-- to label a badge) without needing write access.
create or replace function permit_status_tier(p_status permit_status_enum)
returns text
language sql
immutable
as $$
  select case p_status
    when 'intake' then 'org'
    when 'requirements_review' then 'org'
    when 'collecting_documents' then 'org'
    when 'internal_review' then 'org'
    when 'ready_to_submit' then 'org'
    when 'withdrawn' then 'org'
    when 'submitted' then 'submission'
    when 'under_municipal_review' then 'submission'
    when 'revision_requested' then 'jurisdiction_outcome'
    when 'resubmitted' then 'jurisdiction_outcome'
    when 'appeal_filed' then 'jurisdiction_outcome'
    when 'approved' then 'jurisdiction_outcome'
    when 'rejected' then 'jurisdiction_outcome'
    when 'issued' then 'jurisdiction_outcome'
    when 'expired' then 'jurisdiction_outcome'
    when 'closed' then 'jurisdiction_outcome'
  end;
$$;

grant execute on function permit_status_tier(permit_status_enum) to authenticated, service_role;

-- application_status_history: append-only ledger of every permit_status
-- transition, exact column set the user specified: (org_id, application_id,
-- from_status, to_status, changed_by, reason, created_at), plus
-- `request_key` for idempotency (below). `from_status` is nullable (the
-- seed 'intake' row has none); `to_status` is never null. Composite FK to
-- permit_applications, same cross-org-prevention pattern as
-- clients/properties/projects (20260806000019) -- requires the
-- `permit_applications_org_id_id_key` unique constraint added above.
--
-- request_key: inline nullable column + a PARTIAL unique index, not a
-- separate idempotency table (explicit user decision, and the reasoning is
-- worth preserving here verbatim since it is the architectural rationale for
-- this exact shape): "A separate idempotency table means a two-phase write
-- where the key and the transition can diverge on failure." Nullable so
-- trigger-generated rows (the 'intake' seed row) and any future backfill
-- never need one; the partial unique index on (org_id, application_id,
-- request_key) WHERE request_key IS NOT NULL makes a retried call a no-op
-- AT THE DATABASE LAYER (transition_permit_status() below checks for an
-- existing row with the same key and returns early) rather than something
-- application code has to remember to de-duplicate itself.
create table application_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  from_status permit_status_enum,
  to_status permit_status_enum not null,
  changed_by uuid references auth.users(id),
  reason text,
  request_key uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade
);

create index application_status_history_application_id_idx
  on application_status_history (application_id, created_at);

create unique index application_status_history_request_key_idx
  on application_status_history (org_id, application_id, request_key)
  where request_key is not null;

alter table application_status_history enable row level security;

-- SELECT only, is_org_member-gated -- same visibility boundary as
-- permit_applications itself (20260806000006). Deliberately NO
-- INSERT/UPDATE/DELETE policy for `authenticated` at all: this table has
-- exactly two sanctioned writers, both SECURITY DEFINER functions that run
-- as the table owner and so do not need (and are not granted) any table-
-- level write privilege -- seed_permit_status_history() (the 'intake' seed
-- row, fired by a trigger on permit_applications) and
-- transition_permit_status() (every subsequent transition). A direct
-- `insert into application_status_history` from an ordinary authenticated
-- session hits RLS's default-deny (no policy matches) before it can ever
-- reach the append-only trigger below -- unlike audit_logs, which
-- deliberately allows direct self-attributed inserts, this table's whole
-- point is that every row is a validated, authorized transition, so no
-- direct-insert path is offered at all.
create policy application_status_history_select on application_status_history
  for select to authenticated
  using (is_org_member(org_id));

-- Append-only backstop, same forbid_update_delete() reuse as audit_logs
-- (20260806000018) -- belt-and-suspenders alongside the "no UPDATE/DELETE
-- policy at all" RLS default-deny above, and specifically defeats
-- service_role's BYPASSRLS (20260806000015's documented reasoning).
create trigger application_status_history_append_only
  before update or delete on application_status_history
  for each row execute function forbid_update_delete();

grant select on application_status_history to authenticated;
-- No INSERT grant to `authenticated` or `service_role` -- see the policy
-- comment above; the two SECURITY DEFINER functions below write as the
-- table owner and do not need one. UPDATE/DELETE grants intentionally
-- omitted too (unlike audit_logs' explicit grant-then-trigger-block
-- pattern): there is no direct-write policy here for a grant to interact
-- with, so RLS's own default-deny is already the first, sufficient answer;
-- the trigger remains as the second layer regardless.

-- Fires after every permit_applications INSERT and records the mandatory
-- `NULL -> 'intake'` seed history row (explicit user requirement). Runs as
-- SECURITY DEFINER so it can write to application_status_history without
-- that table needing any INSERT grant for `authenticated`/`service_role` --
-- this is the trigger-generated row request_key's nullability was designed
-- to accommodate (see application_status_history's own comment above).
-- changed_by is auth.uid() when the insert happens inside an authenticated
-- session, and NULL when it doesn't (e.g. a service-role/backend insert
-- with no session) -- changed_by is nullable specifically for this case.
create or replace function seed_permit_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into application_status_history (org_id, application_id, from_status, to_status, changed_by, reason)
  values (new.org_id, new.id, null, new.permit_status, auth.uid(), 'application created');
  return new;
end;
$$;

create trigger permit_applications_seed_status_history
  after insert on permit_applications
  for each row execute function seed_permit_status_history();

-- Sanctioned write path for every permit_status change after creation.
-- SECURITY DEFINER, same RPC-wrapping pattern as create_project_with_intake
-- / verify_jurisdiction_source: does its own explicit authorization checks
-- as its first statements, since SECURITY DEFINER bypasses
-- permit_applications' own RLS entirely.
--
-- Two DELIBERATELY SEPARATE checks, each with its own error, per explicit
-- user instruction ("keep the transition legality check ... separate from
-- the role check ... they'll change on different schedules, and you'll want
-- distinct error messages for 'you can't do that' versus 'that's not a
-- valid move'"):
--   1. Transition legality (permit_status_transitions lookup) -- is this
--      move possible for ANY authorized caller, independent of who is
--      asking. Raises 'invalid_transition: ...' (SQLSTATE 22023) on failure.
--   2. Role authorization (permit_status_tier(p_to_status) against the
--      caller's org_members.role) -- is THIS caller allowed to make this
--      (already-legal) move. Raises 'insufficient_privilege: ...' (SQLSTATE
--      42501) on failure, naming both the caller's actual role and the
--      tier they were missing.
-- A caller who is both unauthorized AND attempting an illegal move sees the
-- legality error first (checked first) -- this is a deliberate ordering
-- choice (a nonsensical move is rejected as nonsensical before the system
-- discusses who's allowed to make it), not a security-relevant one (both
-- checks still run before any write happens either way).
--
-- Idempotency (Gate 1.3 review -- REVISED from the original SELECT
-- COUNT(*) pre-check): if p_request_key is supplied, this function
-- RESERVES it by attempting the application_status_history insert FIRST,
-- via `on conflict (org_id, application_id, request_key) where
-- request_key is not null do nothing`, before doing anything else.
--   - If the insert is rejected by the conflict (0 rows affected per GET
--     DIAGNOSTICS), a row for this exact (org_id, application_id,
--     request_key) already exists -- either a truly concurrent duplicate
--     call that lost a row-level lock race, or a later, fully-sequential
--     retry of an already-committed transition. Either way, this function
--     returns the CURRENT application state as a silent no-op, without
--     running Check 1/Check 2/the cross-machine gate/the UPDATE at all.
--     This is deliberately checked BEFORE those checks: on a sequential
--     retry, v_from_status below would already equal the NEW (post-
--     transition) status, not the one this call was originally validated
--     against, so re-running Check 1 against it would raise a spurious
--     invalid_transition error instead of recognizing the retry.
--   - If the insert succeeds, its row is NOT yet durable in any
--     transactionally-visible sense outside this function call: if any
--     later check in this same function raises (Check 1, Check 2, the
--     cross-machine gate, or the optimistic-concurrency row-count check
--     below), the whole function call's transaction aborts and this insert
--     is rolled back along with it -- so a validation failure never leaves
--     a "reserved but not really executed" history row behind.
--   - Closes the original design's TOCTOU: the old SELECT COUNT(*)
--     pre-check and the later INSERT were two separate statements with a
--     window between them where two concurrent identical retries could
--     both pass the SELECT before either committed the INSERT. A single
--     INSERT ... ON CONFLICT ... DO NOTHING is atomic -- the second
--     concurrent caller blocks on the unique index's row lock until the
--     first commits or rolls back, then correctly sees the conflict (or
--     correctly proceeds, if the first rolled back).
--   - When p_request_key is null, the partial unique index's `where
--     request_key is not null` means a null-key row is never indexed
--     there at all, so this same INSERT statement can never conflict --
--     it always just inserts normally, same as the pre-review behavior for
--     callers that don't supply a request_key.
--
-- Concurrency (Gate 1.3 review -- NEW): the UPDATE below now carries `and
-- permit_status = v_from_status` and checks ROW_COUNT, closing a
-- lost-update race -- without this, two concurrent transitions reading the
-- same v_from_status could both pass Check 1/Check 2 (both legal/
-- authorized against the state each of them read) and both write,
-- silently discarding whichever UPDATE committed first with no error to
-- either caller. With the added WHERE clause, whichever call commits first
-- wins; the second finds 0 rows matching (permit_status has already moved
-- on) and raises concurrent_transition (SQLSTATE 40001, the standard
-- "serialization failure, retry me" family) instead of silently losing the
-- race.
--
-- The cross-machine gate (SS L.3(b), see this migration's header comment):
-- refuses 'submitted' unless the pipeline's own `status` column has already
-- reached its own 'submitted' value. Checked AFTER legality/role (a
-- request that's illegal or unauthorized fails for that reason first, not
-- because of pipeline state) and BEFORE the actual write.
create or replace function transition_permit_status(
  p_application_id uuid,
  p_to_status permit_status_enum,
  p_reason text default null,
  p_request_key uuid default null
)
returns permit_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications;
  v_from_status permit_status_enum;
  v_role org_role;
  v_tier text;
  v_row_count int;
begin
  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'permit_application % not found', p_application_id;
  end if;

  if not is_org_member(v_app.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  v_from_status := v_app.permit_status;

  -- Idempotency reservation -- see the comment above this function.
  insert into application_status_history (org_id, application_id, from_status, to_status, changed_by, reason, request_key)
  values (v_app.org_id, v_app.id, v_from_status, p_to_status, auth.uid(), p_reason, p_request_key)
  on conflict (org_id, application_id, request_key) where request_key is not null do nothing;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    return v_app; -- idempotent no-op: this exact request_key was already recorded.
  end if;

  -- Check 1: transition legality, independent of who is asking.
  if not exists (
    select 1 from permit_status_transitions
    where from_status is not distinct from v_from_status
      and to_status = p_to_status
  ) then
    raise exception 'invalid_transition: % -> % is not a legal permit_status transition', v_from_status, p_to_status
      using errcode = '22023';
  end if;

  -- Check 2: role authorization for the tier being entered, independent of
  -- whether the move itself is legal.
  select role into v_role from org_members where org_id = v_app.org_id and user_id = auth.uid();
  v_tier := permit_status_tier(p_to_status);

  if v_tier = 'submission' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not move an application into submission-tier status % (requires permit_manager or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  if v_tier = 'jurisdiction_outcome' and v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager', 'permit_coordinator') then
    raise exception 'insufficient_privilege: role % may not record jurisdiction-outcome status % (requires permit_coordinator or above)', v_role, p_to_status
      using errcode = '42501';
  end if;

  -- Cross-machine gate: see this migration's header comment (SS L.3(b)).
  if p_to_status = 'submitted' and v_app.status <> 'submitted' then
    raise exception 'pipeline_not_submitted: cannot advance permit_status to submitted until the document pipeline status is submitted (currently %)', v_app.status;
  end if;

  update permit_applications
  set permit_status = p_to_status, updated_at = now()
  where id = p_application_id
    and permit_status = v_from_status
  returning * into v_app;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    raise exception 'concurrent_transition: permit_status for application % changed since this transition was validated (expected %); retry the request', p_application_id, v_from_status
      using errcode = '40001';
  end if;

  return v_app;
end;
$$;

revoke all on function transition_permit_status(uuid, permit_status_enum, text, uuid) from public;
grant execute on function transition_permit_status(uuid, permit_status_enum, text, uuid) to authenticated;

-- Column-level lockout (Gate 1.3 review, round 4 -- the actually-correct
-- version; rounds 2/3 tried a column-level REVOKE layered on top of a
-- pre-existing table-level GRANT and it was a no-op, see Gate 1.3 report
-- SS13 for the full root-cause writeup and the column-privilege
-- enumeration this fix is based on). transition_permit_status() above is
-- the ONLY sanctioned write path for permit_status; a trigger-based guard
-- would still let a direct UPDATE appear to run (and would need its own
-- logic to silently discard or rewrite the value), which is a worse
-- failure mode than a hard, immediate privilege error at the grant layer.
--
-- The model: REVOKE table-level UPDATE entirely, then GRANT it back only
-- on the one column app code actually updates directly today (`status`,
-- the pre-existing pipeline column -- written by
-- app/api/applications/[id]/{submit,confirm-review}/route.ts and
-- lib/inngest/functions/*.ts, per the Gate 1.3 report's exhaustive
-- enumeration of every direct write site). Every other column --
-- `permit_status` included -- ends up with NO UPDATE grant at all: not
-- because it's individually revoked, but because it was never re-granted.
-- This closes the gap by construction instead of by an ineffective
-- add-on revoke; there is no pre-existing broader grant left for a
-- column-level restriction to fail to override.
--   - `anon` never had UPDATE on this table at all (20260806000011 L25:
--     select-only) -- nothing to revoke there.
--   - `service_role` keeps table-level UPDATE (20260806000015 L30). It is
--     not a client-facing role -- it already bypasses RLS by design (that
--     migration's own documented reasoning) -- and nothing in this gate
--     has it write permit_status directly; Inngest's three functions
--     (extract/audit/generate-pdf) only ever touch the pre-existing
--     pipeline `status` column. Left alone deliberately, not an oversight.
--   - transition_permit_status() itself is SECURITY DEFINER, so it
--     executes as the function's owner (the role that ran this migration),
--     not as `authenticated` -- entirely unaffected by either of the
--     grants below.
--   - DELETE on permit_applications is untouched by this fix (still
--     table-level for `authenticated`, per 20260806000011 L15) -- out of
--     scope here; this migration only ever concerned itself with UPDATE.
--   - Verification: supabase/tests/permit_status_machine.test.sql SS13
--     (direct UPDATE of permit_status now rejected, insufficient_privilege
--     /42501) and SS14 (backfill_orphaned_application_projects(), unblocked
--     now that SS13 no longer aborts the file's transaction) -- see the
--     Gate 1.3 report for the actual run output, not just this claim.
revoke update on permit_applications from authenticated;
grant update (status) on permit_applications to authenticated;
