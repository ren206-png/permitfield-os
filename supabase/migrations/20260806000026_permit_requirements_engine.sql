-- Lifecycle & Compliance Expansion, Gate 1.6: "Requirements engine (deterministic
-- only)" (flag PERMITFIELD_FF_REQUIREMENTS). Additive only against every prior
-- migration: no existing column, row, or enum value is renamed, retyped, or
-- removed.
--
-- Architecture citation: PHASE_0_FINDINGS.md SS P (the Gate 1.6 pre-branch
-- addendum, agreed with the user before this branch existed) plus the
-- follow-up round after the branch was opened (P.4's join-table decision and
-- the confirmation that a third, org-scoped table is required):
--   P.1 -- permit_types.compliance_rules (Gate 1.0) and jurisdiction_permit_rules
--         (this migration) answer different questions and do not conflict.
--         compliance_rules is untouched by this migration.
--   P.2 -- permit_requirements.verified_by is `uuid references auth.users(id)`,
--         matching the jurisdiction_sources precedent (20260806000021), not
--         permit_types.verified_by's unenforced `text`.
--   P.3 -- readiness_checklist_items.source_requirement_id is retrofitted in
--         this same migration, targeting project_permit_requirements(id) (the
--         per-project evaluation row), not permit_requirements(id) (the
--         global catalog row) -- the checklist item is checking off THIS
--         project's specific matched-and-reviewed requirement, not a generic
--         catalog entry. The existing free-text source_requirement column is
--         untouched.
--   P.4 -- Classification dimensions (property type, work type, occupancy/use,
--         scope attributes) are modeled via a single join table,
--         project_taxonomy_selections, reusing the existing org-configurable
--         taxonomies table (20260806000019) rather than new hard-coded tables
--         per dimension -- see that table's own header comment below for why
--         the originally-discussed "discrete table per dimension" design was
--         rejected as a conflict with SS3.2's explicit "do not hard-code the
--         list" instruction for property_type/work_type.
--   P.5 -- Entitlement key is 'jurisdiction.requirements' (this repo's
--         dot-namespaced convention) -- added to lib/entitlements/index.ts in
--         a follow-up commit, not this migration (that file has no DB
--         dependency and this migration has no call site for it yet, same
--         "declared now, wired later" split every prior gate used).
--   (unlabeled, surfaced after P.5) -- SS3.4 line 181 ("Every engine output is
--         preliminary until an authorized permit_manager reviews it --
--         `preliminary` is a persisted column") describes PER-PROJECT state,
--         not catalog data. This confirmed (not just suspected) that two
--         global catalog tables are insufficient -- a third, org-scoped table
--         is required to hold the engine's per-project output. That table is
--         project_permit_requirements below.
--
-- WHAT THIS MIGRATION DOES NOT DO (flagged, not silently decided):
--   - No deterministic evaluation function/RPC. SS3.4 requires "rules are
--     data, evaluated deterministically... write a test that asserts this
--     across 100 iterations" and "zero AI in the decision path" -- the engine
--     that actually reads jurisdiction_permit_rules and writes
--     project_permit_requirements rows does not exist yet. This migration
--     ships the schema those future writes will target; the evaluation
--     function, its 100-iteration determinism test, and the route/Server
--     Action that calls it are the next piece of this same gate, explicitly
--     deferred to a follow-up migration/commit on this branch, not silently
--     dropped.
--   - No RLS write policy (INSERT/UPDATE) for `authenticated` on
--     project_permit_requirements. Rows are written only by the future
--     evaluation RPC (SECURITY DEFINER) and reviewed only by permit_manager+
--     through a future review RPC -- same "table exists, no direct-write
--     policy until its RPC exists" deferral readiness_checklist.sql used for
--     application_documents' review columns (20260806000025 L36-38). SELECT
--     is org-member-gated now so a future read-only UI has something to call
--     immediately.
--   - No entitlement wiring. 'jurisdiction.requirements' is P.5's agreed key
--     but is not added to lib/entitlements/index.ts in this commit -- that
--     file has zero DB dependency and no call site yet in this gate, so it is
--     a separate, small follow-up rather than bundled into a schema
--     migration.
--   - No seed data for the new taxonomy kinds ('property_type', 'work_type',
--     'occupancy_use', 'scope_attribute'). Unlike Gate 1.1's 'project_type'
--     seed (20260806000019 L292-297), SS3.2's "seeded with the brief's
--     example list" cites an external brief document not present in this
--     repo -- inventing example values here would be exactly the fabrication
--     pattern this session has repeatedly had to correct. Orgs start with
--     zero rows in these four kinds until a platform_admin or the org itself
--     adds them via the existing taxonomies_insert policy.
--   - required_documents / required_forms / prerequisite_approvals on
--     permit_requirements are plain `jsonb` arrays, not new join tables
--     against application_documents' document_category or Gate 1.4's
--     filing_form_templates. SS3.4 does not ask for those to be
--     cross-referenced to other entities (a required "form" at the catalog
--     level is a description of what the jurisdiction requires, not yet a
--     specific generated document), and inventing that cross-reference now
--     would be unrequested scope. Same shape/reasoning as
--     permit_types.compliance_rules (Gate 1.0): hand-curated jsonb, not
--     model-generated, not normalized further than the spec asks for.

-- ---------------------------------------------------------------------------
-- Classification dimensions: extend the existing, org-configurable
-- `taxonomies` table (20260806000019) with a join table rather than new
-- per-dimension tables. `taxonomies.kind` is already a plain-text
-- discriminator designed for exactly this ("a text column lets a later phase
-- add a second kind... without an enum migration", 20260806000019 L57-58) --
-- 'property_type' / 'work_type' / 'occupancy_use' / 'scope_attribute' are
-- four new kind values, no schema change to taxonomies itself beyond the one
-- additive unique constraint below.
-- ---------------------------------------------------------------------------

-- Additive: enables the true composite FK below (org_id, taxonomy_id, kind),
-- so a project_taxonomy_selections row cannot reference a taxonomies row
-- under the wrong kind (e.g. inserting kind='property_type' while pointing at
-- a taxonomies row whose actual kind is 'work_type') -- enforced at the
-- database layer, independent of and prior to any RLS or application check,
-- same composite-FK discipline 20260806000019's own header comment
-- establishes for cross-org prevention, applied here to cross-kind
-- prevention instead. Zero behavior change to any existing query, policy, or
-- the pre-existing `unique (org_id, id)` constraint.
alter table taxonomies add constraint taxonomies_org_id_id_kind_key unique (org_id, id, kind);

-- One row per classification value selected on a project. Single-select
-- dimensions ('property_type', 'work_type', 'occupancy_use') are constrained
-- to at most one row per (project, kind) by the partial unique index below;
-- 'scope_attribute' is deliberately left unconstrained there since SS3.4
-- lists "scope attributes" as multi-valued per project.
create table project_taxonomy_selections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null,
  taxonomy_id uuid not null,
  kind text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, project_id) references projects (org_id, id) on delete cascade,
  foreign key (org_id, taxonomy_id, kind) references taxonomies (org_id, id, kind),
  unique (project_id, taxonomy_id)
);

-- Single-select enforcement (P.4): at most one selection per project for
-- each of these three kinds. No such constraint for 'scope_attribute' or any
-- future kind added to this table -- absence of a partial-index branch for a
-- kind means that kind is multi-valued by default, not single-valued by
-- omission.
create unique index project_taxonomy_selections_single_select_uidx
  on project_taxonomy_selections (project_id, kind)
  where kind in ('property_type', 'work_type', 'occupancy_use');

create index project_taxonomy_selections_org_id_idx on project_taxonomy_selections (org_id);
create index project_taxonomy_selections_project_id_idx on project_taxonomy_selections (org_id, project_id);
create index project_taxonomy_selections_taxonomy_id_idx on project_taxonomy_selections (org_id, taxonomy_id);

alter table project_taxonomy_selections enable row level security;

-- Same tier as clients/properties/projects (20260806000019 L204-207): this is
-- normal project-editing data, not owner-managed shared configuration (that's
-- the taxonomies table itself, still gated by taxonomies_insert/_update's
-- is_org_owner()). Any org member may select/change/clear a project's
-- classification values, same as they may edit the project's other fields.
create policy project_taxonomy_selections_select on project_taxonomy_selections
  for select to authenticated
  using (is_org_member(org_id));

create policy project_taxonomy_selections_insert on project_taxonomy_selections
  for insert to authenticated
  with check (is_org_member(org_id));

-- No UPDATE policy -- a selection row has no mutable field other than which
-- taxonomy_id/kind it points to, and changing either is indistinguishable
-- from "delete this selection, insert a new one" (the join table itself is
-- the association, not an entity with its own lifecycle). DELETE + INSERT
-- covers "change my mind about the work type" without an UPDATE policy that
-- would just duplicate the same is_org_member() check for no added
-- capability.
create policy project_taxonomy_selections_delete on project_taxonomy_selections
  for delete to authenticated
  using (is_org_member(org_id));

grant select, insert, delete on project_taxonomy_selections to authenticated;
grant select, insert, update, delete on project_taxonomy_selections to service_role;

-- ---------------------------------------------------------------------------
-- permit_requirements: global, hand-curated catalog (jurisdiction x permit
-- type -> what's actually required). Same reference-data shape as
-- jurisdiction_sources (20260806000021): broad `authenticated` SELECT,
-- INSERT/UPDATE gated to is_platform_admin() (reused verbatim from that
-- migration, not redefined here), no DELETE policy (archival only, same
-- global rule as every archived_at table in this schema).
-- ---------------------------------------------------------------------------

-- New type, not a reuse of jurisdiction_source_verification_status, even
-- though the five values are identical -- same "shape mirrors an existing
-- enum but is defined as its own type because it's a different entity"
-- precedent readiness_item_status set against document_review_status
-- (20260806000025 L71-73). permit_requirements and jurisdiction_sources are
-- conceptually distinct curated artifacts and may need to diverge later.
create type permit_requirement_verification_status as enum (
  'unverified',
  'pending_review',
  'verified',
  'stale',
  'disputed'
);

create table permit_requirements (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  permit_type_id uuid not null references permit_types(id) on delete cascade,
  title text not null,
  description text,
  required_documents jsonb not null default '[]'::jsonb,
  required_forms jsonb not null default '[]'::jsonb,
  prerequisite_approvals jsonb not null default '[]'::jsonb,
  -- fee_cents follows permit_applications.estimated_job_value_cents's
  -- float-free convention (lib/money/cents.ts) -- no fee_* precedent exists
  -- elsewhere in this schema, so this migration establishes the first one
  -- rather than inventing a parallel numeric/decimal representation.
  -- Nullable: a platform_admin may be drafting a row before the fee is known
  -- or verified -- "verified fees only" (SS3.4) is enforced at render time by
  -- checking verification_status = 'verified' before displaying this column,
  -- same "computed/checked at read time, not gated by a second constraint"
  -- reasoning jurisdiction_source_effective_status uses for staleness, not by
  -- co-gating fee_cents to verification_status with an additional CHECK.
  fee_cents bigint,
  processing_estimate_min_days integer,
  processing_estimate_max_days integer,
  source_id uuid references jurisdiction_sources(id),
  verification_status permit_requirement_verification_status not null default 'unverified',
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permit_requirements_fee_range check (
    processing_estimate_min_days is null
    or processing_estimate_max_days is null
    or processing_estimate_min_days <= processing_estimate_max_days
  ),
  -- SS3.4's hard constraint, verbatim: "a permit_requirement row cannot be
  -- marked official/authoritative unless verified_at IS NOT NULL AND
  -- verified_by IS NOT NULL AND source_id IS NOT NULL." "Official/
  -- authoritative" is modeled as verification_status = 'verified', same
  -- status-enum shape jurisdiction_sources already uses for its own,
  -- one-column-lighter version of this same constraint
  -- (jurisdiction_sources_verified_requires_reviewer, 20260806000021 L113-116).
  constraint permit_requirements_verified_requires_all_three check (
    verification_status <> 'verified'
    or (verified_at is not null and verified_by is not null and source_id is not null)
  )
);

create index permit_requirements_jurisdiction_id_idx on permit_requirements (jurisdiction_id);
create index permit_requirements_permit_type_id_idx on permit_requirements (permit_type_id);
create index permit_requirements_source_id_idx on permit_requirements (source_id);

alter table permit_requirements enable row level security;

create policy permit_requirements_select on permit_requirements
  for select to authenticated
  using (true);

create policy permit_requirements_insert on permit_requirements
  for insert to authenticated
  with check (is_platform_admin());

-- Same forged-actor defense as jurisdiction_sources_update
-- (20260806000021 L163-174): a direct UPDATE cannot set verified_by to
-- anyone but the caller.
create policy permit_requirements_update on permit_requirements
  for update to authenticated
  using (is_platform_admin())
  with check (is_platform_admin() and (verified_by is null or verified_by = auth.uid()));

grant select, insert, update on permit_requirements to authenticated;
grant select, insert, update on permit_requirements to service_role;

-- ---------------------------------------------------------------------------
-- jurisdiction_permit_rules: rules-as-data (SS3.4: "Rules are data... evaluated
-- deterministically"). Each row is one matching condition that resolves to a
-- permit_requirements row. jurisdiction_id is deliberately NOT duplicated
-- here -- it's derived via permit_requirement_id -> permit_requirements.jurisdiction_id,
-- avoiding two columns that could disagree with each other.
--
-- property_type_code / work_type_code / occupancy_use_code reference
-- taxonomies.code (not taxonomies.id) -- rules are meant to be portable,
-- human-authored data ("new construction requires X"), and taxonomies.code is
-- the stable, human-legible identifier for a classification value within a
-- kind (unique (org_id, kind, code), 20260806000019 L74), whereas
-- project_taxonomy_selections above stores the id because it's a live FK to a
-- specific org's row. NULL in any of the three *_code columns means "matches
-- any value for that dimension," not "matches projects with no value set" --
-- same "absence means unconstrained, not excluded" semantics as
-- permit_type_filings.is_conditional_on's jsonb (20260806000005).
--
-- required_scope_attribute_codes: scope attributes are multi-valued (P.4), so
-- a single *_code column can't express "requires attribute A AND attribute
-- B." A plain text[] column (ALL codes listed must be present among the
-- project's scope_attribute selections for the rule to match) is deterministic
-- and avoids a second join table for what is, at the rules level, read-only
-- reference data rather than a live per-project association. NULL/empty
-- array means "no scope-attribute requirement," same "absence = unconstrained"
-- convention as the three *_code columns.
-- ---------------------------------------------------------------------------
create table jurisdiction_permit_rules (
  id uuid primary key default gen_random_uuid(),
  permit_requirement_id uuid not null references permit_requirements(id) on delete cascade,
  property_type_code text,
  work_type_code text,
  occupancy_use_code text,
  required_scope_attribute_codes text[],
  min_construction_value_cents bigint,
  max_construction_value_cents bigint,
  priority int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jurisdiction_permit_rules_value_range check (
    min_construction_value_cents is null
    or max_construction_value_cents is null
    or min_construction_value_cents <= max_construction_value_cents
  )
);

create index jurisdiction_permit_rules_permit_requirement_id_idx on jurisdiction_permit_rules (permit_requirement_id);

alter table jurisdiction_permit_rules enable row level security;

-- Same shape as permit_requirements above: broad read, platform_admin-only
-- write, no delete policy.
create policy jurisdiction_permit_rules_select on jurisdiction_permit_rules
  for select to authenticated
  using (true);

create policy jurisdiction_permit_rules_insert on jurisdiction_permit_rules
  for insert to authenticated
  with check (is_platform_admin());

create policy jurisdiction_permit_rules_update on jurisdiction_permit_rules
  for update to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

grant select, insert, update on jurisdiction_permit_rules to authenticated;
grant select, insert, update on jurisdiction_permit_rules to service_role;

-- ---------------------------------------------------------------------------
-- project_permit_requirements: org-scoped, per-project engine OUTPUT (the
-- table confirmed necessary by SS3.4 L181's "preliminary is a persisted
-- column" -- see this migration's header comment). Each row is either a
-- MATCHED requirement (permit_requirement_id set, produced by some
-- jurisdiction_permit_rules row) or an UNRESOLVED question (SS3.4: "Unknown
-- inputs produce an explicit unresolved_question, never a guess... 'No rule
-- found' is a valid, visible output") -- the two flavors are distinguished
-- and mutually exclusive via the CHECK constraint below, not two separate
-- tables, so "everything the engine produced for this project" stays one
-- queryable set matching SS3.4's own combined output list ("...warnings and
-- unresolved questions").
-- ---------------------------------------------------------------------------
create table project_permit_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null,
  permit_requirement_id uuid references permit_requirements(id),
  jurisdiction_permit_rule_id uuid references jurisdiction_permit_rules(id) on delete set null,
  unresolved_reason text,
  -- SS3.4 L181, verbatim: "Every engine output is preliminary until an
  -- authorized permit_manager reviews it. preliminary is a persisted column,
  -- not a UI label." Defaults true -- no row is ever inserted already
  -- reviewed; only the future review RPC (not part of this migration, see
  -- header comment) flips this to false alongside setting reviewed_by/
  -- reviewed_at.
  preliminary boolean not null default true,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  warnings jsonb not null default '[]'::jsonb,
  -- Snapshot of the classification inputs (property_type/work_type/
  -- occupancy_use/scope_attribute codes, construction_value_cents) this row
  -- was evaluated against, captured at evaluation time. Required (not
  -- nullable) for two reasons: it's the input SS3.4's 100-iteration
  -- determinism test re-runs against to assert "same inputs -> same output,"
  -- and it's the audit trail proving what the engine actually saw, independent
  -- of whatever the live project_taxonomy_selections rows say by the time
  -- someone reviews this output later (a project's classification can change
  -- after evaluation; this snapshot must not).
  evaluation_inputs jsonb not null,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, project_id) references projects (org_id, id) on delete cascade,
  constraint project_permit_requirements_reviewed_pair check (
    (reviewed_by is null) = (reviewed_at is null)
  ),
  -- Matched XOR unresolved: a matched row carries permit_requirement_id and
  -- no unresolved_reason; an unresolved row carries unresolved_reason and
  -- neither permit_requirement_id nor jurisdiction_permit_rule_id. Never
  -- both, never neither -- SS3.4 treats "no rule found" as a real, distinct
  -- output, not a null/empty absence.
  constraint project_permit_requirements_matched_or_unresolved check (
    (permit_requirement_id is not null and unresolved_reason is null)
    or (permit_requirement_id is null and jurisdiction_permit_rule_id is null and unresolved_reason is not null)
  )
);

create index project_permit_requirements_org_id_idx on project_permit_requirements (org_id);
create index project_permit_requirements_project_id_idx on project_permit_requirements (org_id, project_id);
create index project_permit_requirements_permit_requirement_id_idx on project_permit_requirements (permit_requirement_id);

alter table project_permit_requirements enable row level security;

-- SELECT only -- see this migration's header comment ("what this migration
-- does not do") for why no INSERT/UPDATE policy or grant exists yet for
-- `authenticated`. service_role gets select/insert/update proactively, same
-- "grant ahead of the job that needs it" convention as every other new table
-- in this schema.
create policy project_permit_requirements_select on project_permit_requirements
  for select to authenticated
  using (is_org_member(org_id));

grant select on project_permit_requirements to authenticated;
grant select, insert, update on project_permit_requirements to service_role;

-- No `updated_at`-maintaining trigger on any table in this migration --
-- matches every existing table in this schema (grep-confirmed zero BEFORE
-- UPDATE triggers exist anywhere in supabase/migrations/, per
-- 20260806000019's own comment). `updated_at` is set explicitly by whatever
-- future write path touches these rows (the evaluation RPC, the review RPC,
-- or a platform_admin's direct catalog edit).

-- ---------------------------------------------------------------------------
-- P.3 retrofit: readiness_checklist_items.source_requirement_id, nullable and
-- additive, targeting project_permit_requirements (not permit_requirements --
-- see this migration's header comment). The existing free-text
-- source_requirement column (20260806000025 L98-102) is untouched; this adds
-- a second, real-FK column alongside it. No backfill: every existing row's
-- source_requirement_id starts NULL, same as every other additive nullable
-- column this schema has ever added (e.g. readiness_override_* in the same
-- migration that created this table).
-- ---------------------------------------------------------------------------
alter table readiness_checklist_items
  add column source_requirement_id uuid references project_permit_requirements(id);

create index readiness_checklist_items_source_requirement_id_idx
  on readiness_checklist_items (source_requirement_id);
