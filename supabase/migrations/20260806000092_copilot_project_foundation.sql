-- Gate 6, sub-phase 6.1 (GATE_6_FINDINGS.md §D "Collect project facts",
-- §G), migration 2 of 2: the ORG-SCOPED half of the copilot foundation.
-- Schema only; nothing reads or writes these tables yet (6.2 writes
-- snapshots, 6.4 writes facts and tool invocations). Additive: no existing
-- table, column, policy or grant is changed.
--
-- Tables (all append-only):
--   project_facts                  typed project facts with provenance and a
--                                  proposed -> confirmed/rejected state; a
--                                  correction is a new row that supersedes
--                                  the old one. A user-confirmed fact is not
--                                  independently verified evidence (master
--                                  prompt §8) -- review state and provenance
--                                  are separate columns.
--   project_requirement_snapshots  the outcome of evaluating one requirement
--                                  against a set of fact versions and a
--                                  published rule set, three-valued
--                                  (applicable / not_applicable / unknown).
--                                  "not_applicable" requires an evaluated
--                                  rule set: missing data can only ever be
--                                  "unknown" (master prompt §9).
--   copilot_tool_invocations       one row per copilot tool call, for audit,
--                                  cost and reproducibility (master prompt
--                                  §12).
--
-- Tenant isolation is at the database: every table carries org_id, and
-- reads go through is_org_member()/can_read_ai_ledger(), which take the
-- caller from the session (auth.uid()), never from a model- or
-- client-supplied value (master prompt §1.8). project_id is tied to org_id
-- by the composite foreign key to projects (org_id, id)
-- (20260806000019:143-164), so a row can never pair one org's id with
-- another org's project.
--
-- Grants follow 20260806000091's header: revoke Supabase's default ALL
-- (incl. TRUNCATE) from anon/authenticated/service_role, then grant only
-- what each table needs. Org deletion (delete_account(),
-- 20260806000090) cascades through the org_id foreign keys;
-- forbid_update_delete() lets those cascades through only while
-- account_deletion_in_progress() is set.
--
-- ROLLBACK (manual; only valid while no other object references these):
--   drop table if exists copilot_tool_invocations;
--   drop table if exists project_requirement_snapshots;
--   drop table if exists project_facts;
--   drop type if exists copilot_tool_status;
--   drop type if exists requirement_applicability;
--   drop type if exists project_fact_state;
--   drop type if exists project_fact_provenance;

create type project_fact_provenance as enum (
  'user_entered',
  'document_extraction',
  'drawing_review',
  'authority_record',
  'system'
);

create type project_fact_state as enum ('proposed', 'confirmed', 'rejected');

create type requirement_applicability as enum ('applicable', 'not_applicable', 'unknown');

create type copilot_tool_status as enum ('succeeded', 'failed', 'rejected');

-- ---------------------------------------------------------------------------
-- project_facts
-- ---------------------------------------------------------------------------
create table project_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_.]{0,99}$'),
  value jsonb not null,
  unit text check (unit is null or length(btrim(unit)) between 1 and 32),
  provenance project_fact_provenance not null,
  -- The document a fact was read from, plus where in it (page/region/cell).
  -- Deliberately no foreign key: application_documents rows can be deleted
  -- (application_documents_delete, 20260806000006:97), and an ON DELETE
  -- action here would have to UPDATE or DELETE this append-only row.
  source_document_id uuid,
  source_locator text,
  state project_fact_state not null default 'proposed',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  supersedes_fact_id uuid references project_facts(id),
  -- Null only for machine-proposed facts written by service_role.
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (org_id, project_id) references projects (org_id, id) on delete cascade,
  constraint project_facts_review_matches_state check (
    (state = 'proposed') = (reviewed_by is null and reviewed_at is null)
  ),
  constraint project_facts_user_entered_has_author check (
    provenance <> 'user_entered' or created_by is not null
  ),
  constraint project_facts_locator_needs_document check (
    source_locator is null or source_document_id is not null
  ),
  constraint project_facts_not_self_superseding check (supersedes_fact_id <> id)
);

create index project_facts_project_idx on project_facts (org_id, project_id, fact_key, created_at desc);

-- ---------------------------------------------------------------------------
-- project_requirement_snapshots
-- ---------------------------------------------------------------------------
create table project_requirement_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null,
  rule_set_version_id uuid references rule_set_versions(id) on delete restrict,
  permit_requirement_id uuid references permit_requirements(id) on delete restrict,
  outcome requirement_applicability not null,
  -- The exact project_facts rows (versions) this evaluation read.
  fact_ids uuid[] not null default '{}',
  -- Explanation trace: which conditions were evaluated and what was missing.
  explanation jsonb not null check (jsonb_typeof(explanation) = 'object'),
  evaluated_by uuid references auth.users(id),
  evaluated_at timestamptz not null default now(),
  foreign key (org_id, project_id) references projects (org_id, id) on delete cascade,
  constraint project_requirement_snapshots_not_applicable_needs_rule check (
    outcome <> 'not_applicable' or rule_set_version_id is not null
  )
);

create index project_requirement_snapshots_project_idx
  on project_requirement_snapshots (org_id, project_id, evaluated_at desc);

-- ---------------------------------------------------------------------------
-- copilot_tool_invocations
-- ---------------------------------------------------------------------------
create table copilot_tool_invocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid,
  user_id uuid not null references auth.users(id),
  trace_id uuid not null,
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{2,63}$'),
  arguments jsonb not null,
  result jsonb,
  status copilot_tool_status not null,
  error_message text,
  model_id text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  foreign key (org_id, project_id) references projects (org_id, id) on delete cascade,
  constraint copilot_tool_invocations_failure_has_message check (
    status = 'succeeded' or error_message is not null
  )
);

create index copilot_tool_invocations_org_idx on copilot_tool_invocations (org_id, created_at desc);
create index copilot_tool_invocations_trace_idx on copilot_tool_invocations (trace_id);

-- ---------------------------------------------------------------------------
-- RLS, append-only triggers, grants
-- ---------------------------------------------------------------------------
alter table project_facts enable row level security;
alter table project_requirement_snapshots enable row level security;
alter table copilot_tool_invocations enable row level security;

create policy project_facts_select on project_facts
  for select to authenticated using (is_org_member(org_id));
-- A member records facts for their own org as themselves; a fact they
-- confirm or reject at insert time must name themselves as the reviewer.
create policy project_facts_insert on project_facts
  for insert to authenticated
  with check (
    is_org_member(org_id)
    and created_by = auth.uid()
    and (reviewed_by is null or reviewed_by = auth.uid())
  );

-- Snapshots and tool invocations are written by server code only
-- (service_role); members read them.
create policy project_requirement_snapshots_select on project_requirement_snapshots
  for select to authenticated using (is_org_member(org_id));

-- Same elevated-role read gate as ai_jobs / ai_token_ledger
-- (can_read_ai_ledger, 20260806000036:184): tool arguments and results can
-- carry project content and cost data.
create policy copilot_tool_invocations_select on copilot_tool_invocations
  for select to authenticated using (can_read_ai_ledger(org_id));

create trigger project_facts_append_only
  before update or delete on project_facts
  for each row execute function forbid_update_delete();
create trigger project_requirement_snapshots_append_only
  before update or delete on project_requirement_snapshots
  for each row execute function forbid_update_delete();
create trigger copilot_tool_invocations_append_only
  before update or delete on copilot_tool_invocations
  for each row execute function forbid_update_delete();

revoke all on project_facts, project_requirement_snapshots, copilot_tool_invocations
  from anon, authenticated, service_role;

grant select, insert on project_facts to authenticated;
grant select on project_requirement_snapshots, copilot_tool_invocations to authenticated;
grant select, insert on project_facts, project_requirement_snapshots, copilot_tool_invocations
  to service_role;
