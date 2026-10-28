-- Gate 6, sub-phase 6.1 (GATE_6_FINDINGS.md §G, open items O4/O5), migration
-- 1 of 2: the GLOBAL catalogue half of the copilot foundation. Schema only:
-- no function, no trigger body, no flag and no UI reads these tables yet
-- (6.2 wires the rule engine, 6.3 the source review console). Additive: no
-- existing table, column, policy or grant is changed.
--
-- Tables (all append-only -- a correction is a new row that points at what it
-- supersedes, never an UPDATE):
--   source_revisions         immutable snapshot identity of one official
--                            source (jurisdiction_sources stays the mutable
--                            "this URL exists" registry, 20260806000021:93;
--                            O4: it has no hash, revisions or supersession).
--   source_revision_reviews  review decisions on a revision; the current state
--                            is the latest row. Reuses
--                            jurisdiction_source_verification_status
--                            (20260806000021:62) rather than a parallel enum.
--   coverage_records         coverage per jurisdiction + authority + permit
--                            type + project scope + effective period (O5:
--                            jurisdictions.coverage_level is per city only).
--   rule_set_versions        a published, immutable set of requirements for
--   rule_set_version_items   one jurisdiction + permit type; each item freezes
--                            the permit_requirements row as it was published.
--   fee_schedule_versions    verified fee schedules: integer minor units are
--                            computed by the 6.5 engine from `parameters`;
--                            currency and rounding rule live on the version
--                            (master prompt D2). A schedule must cite a source
--                            revision -- no schedule means "unavailable", never
--                            zero.
--
-- Access: readable by any signed-in user (catalogue metadata, like
-- jurisdictions/authorities/jurisdiction_sources, 20260806000021:155-157);
-- writable only by platform_admin users acting as themselves (the actor
-- column must equal auth.uid(), same forged-actor defence as
-- jurisdiction_sources_update, 20260806000021:171-174). service_role may read
-- and insert (6.3's refresh jobs). Nobody may UPDATE, DELETE or TRUNCATE.
--
-- Grants are explicit and minimal. Supabase's default privileges give anon
-- and authenticated ALL (including TRUNCATE, which bypasses RLS and row
-- triggers) on every new public table, so each table below starts with
-- `revoke all ... from anon, authenticated, service_role` and then grants
-- only what it needs. That also makes an UPDATE/DELETE attempt fail loudly
-- with "permission denied" instead of silently matching zero rows under RLS;
-- forbid_update_delete() (20260806000090:36) stays on as a second layer for
-- any role that does hold the privilege (e.g. postgres), and it already
-- honours account_deletion_in_progress().
--
-- ROLLBACK (manual; only valid while no other object references these):
--   drop table if exists fee_schedule_versions;
--   drop table if exists rule_set_version_items;
--   drop table if exists rule_set_versions;
--   drop table if exists coverage_records;
--   drop table if exists source_revision_reviews;
--   drop table if exists source_revisions;
--   drop type if exists fee_rounding_rule;
--   drop type if exists source_access_scope;

create type source_access_scope as enum (
  'public',                    -- may be quoted and redistributed
  'public_no_redistribution',  -- readable online, not republishable
  'licensed_internal'          -- licensed; internal use only
);

create type fee_rounding_rule as enum (
  'half_up_to_cent',
  'half_even_to_cent',
  'up_to_dollar',
  'down_to_dollar'
);

-- ---------------------------------------------------------------------------
-- source_revisions
-- ---------------------------------------------------------------------------
create table source_revisions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references jurisdiction_sources(id) on delete restrict,
  revision_number integer not null check (revision_number >= 1),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Storage path of the retained snapshot, when the licence permits one.
  snapshot_storage_path text,
  title text not null check (length(btrim(title)) > 0),
  issuing_body text not null check (length(btrim(issuing_body)) > 0),
  -- Unknown dates stay null; they are never guessed (master prompt §7).
  published_on date,
  effective_from date,
  effective_to date,
  retrieved_at timestamptz not null,
  access_scope source_access_scope not null,
  licence_notes text,
  supersedes_revision_id uuid references source_revisions(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (source_id, revision_number),
  unique (source_id, content_sha256),
  constraint source_revisions_effective_window check (
    effective_from is null or effective_to is null or effective_from <= effective_to
  ),
  constraint source_revisions_not_self_superseding check (supersedes_revision_id <> id)
);

create index source_revisions_source_id_idx on source_revisions (source_id);

-- ---------------------------------------------------------------------------
-- source_revision_reviews
-- ---------------------------------------------------------------------------
create table source_revision_reviews (
  id uuid primary key default gen_random_uuid(),
  source_revision_id uuid not null references source_revisions(id) on delete restrict,
  status jurisdiction_source_verification_status not null,
  notes text,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now()
);

create index source_revision_reviews_revision_idx
  on source_revision_reviews (source_revision_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- coverage_records
-- ---------------------------------------------------------------------------
create table coverage_records (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete restrict,
  authority_id uuid references authorities(id) on delete restrict,
  permit_type_id uuid references permit_types(id) on delete restrict,
  project_scope text not null check (project_scope ~ '^[a-z0-9_]+$'),
  coverage_level coverage_level not null,
  effective_from date not null,
  effective_to date,
  -- A 'verified' claim must point at the source revision that backs it.
  source_revision_id uuid references source_revisions(id),
  known_gaps text,
  supersedes_coverage_id uuid references coverage_records(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint coverage_records_effective_window check (
    effective_to is null or effective_from <= effective_to
  ),
  constraint coverage_records_verified_needs_source check (
    coverage_level <> 'verified' or source_revision_id is not null
  ),
  constraint coverage_records_not_self_superseding check (supersedes_coverage_id <> id)
);

create index coverage_records_jurisdiction_idx on coverage_records (jurisdiction_id, permit_type_id);

-- ---------------------------------------------------------------------------
-- rule_set_versions / rule_set_version_items
-- ---------------------------------------------------------------------------
create table rule_set_versions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete restrict,
  permit_type_id uuid not null references permit_types(id) on delete restrict,
  version integer not null check (version >= 1),
  supersedes_rule_set_id uuid references rule_set_versions(id),
  notes text,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (jurisdiction_id, permit_type_id, version),
  constraint rule_set_versions_not_self_superseding check (supersedes_rule_set_id <> id)
);

create table rule_set_version_items (
  id uuid primary key default gen_random_uuid(),
  rule_set_version_id uuid not null references rule_set_versions(id) on delete restrict,
  permit_requirement_id uuid not null references permit_requirements(id) on delete restrict,
  -- The permit_requirements row exactly as published; later edits to the live
  -- row never rewrite a published version (master prompt §7).
  requirement_snapshot jsonb not null check (jsonb_typeof(requirement_snapshot) = 'object'),
  source_revision_id uuid references source_revisions(id),
  created_at timestamptz not null default now(),
  unique (rule_set_version_id, permit_requirement_id)
);

create index rule_set_version_items_version_idx on rule_set_version_items (rule_set_version_id);

-- ---------------------------------------------------------------------------
-- fee_schedule_versions
-- ---------------------------------------------------------------------------
create table fee_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete restrict,
  authority_id uuid references authorities(id) on delete restrict,
  permit_type_id uuid references permit_types(id) on delete restrict,
  version integer not null check (version >= 1),
  currency char(3) not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  rounding_rule fee_rounding_rule not null,
  effective_from date not null,
  effective_to date,
  -- Tiers, rates, minimums and exclusions, schema-validated by the 6.5 fee
  -- engine (Zod) before use. Amounts inside are integer minor units.
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  source_revision_id uuid not null references source_revisions(id),
  supersedes_fee_schedule_id uuid references fee_schedule_versions(id),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique nulls not distinct (jurisdiction_id, authority_id, permit_type_id, version),
  constraint fee_schedule_versions_effective_window check (
    effective_to is null or effective_from <= effective_to
  ),
  constraint fee_schedule_versions_not_self_superseding check (supersedes_fee_schedule_id <> id)
);

-- ---------------------------------------------------------------------------
-- RLS, append-only triggers, grants (same shape for all six tables)
-- ---------------------------------------------------------------------------
alter table source_revisions enable row level security;
alter table source_revision_reviews enable row level security;
alter table coverage_records enable row level security;
alter table rule_set_versions enable row level security;
alter table rule_set_version_items enable row level security;
alter table fee_schedule_versions enable row level security;

create policy source_revisions_select on source_revisions
  for select to authenticated using (true);
create policy source_revisions_insert on source_revisions
  for insert to authenticated
  with check (is_platform_admin() and created_by = auth.uid());

create policy source_revision_reviews_select on source_revision_reviews
  for select to authenticated using (true);
create policy source_revision_reviews_insert on source_revision_reviews
  for insert to authenticated
  with check (is_platform_admin() and reviewed_by = auth.uid());

create policy coverage_records_select on coverage_records
  for select to authenticated using (true);
create policy coverage_records_insert on coverage_records
  for insert to authenticated
  with check (is_platform_admin() and created_by = auth.uid());

create policy rule_set_versions_select on rule_set_versions
  for select to authenticated using (true);
create policy rule_set_versions_insert on rule_set_versions
  for insert to authenticated
  with check (is_platform_admin() and published_by = auth.uid());

create policy rule_set_version_items_select on rule_set_version_items
  for select to authenticated using (true);
create policy rule_set_version_items_insert on rule_set_version_items
  for insert to authenticated
  with check (is_platform_admin());

create policy fee_schedule_versions_select on fee_schedule_versions
  for select to authenticated using (true);
create policy fee_schedule_versions_insert on fee_schedule_versions
  for insert to authenticated
  with check (is_platform_admin() and published_by = auth.uid());

create trigger source_revisions_append_only
  before update or delete on source_revisions
  for each row execute function forbid_update_delete();
create trigger source_revision_reviews_append_only
  before update or delete on source_revision_reviews
  for each row execute function forbid_update_delete();
create trigger coverage_records_append_only
  before update or delete on coverage_records
  for each row execute function forbid_update_delete();
create trigger rule_set_versions_append_only
  before update or delete on rule_set_versions
  for each row execute function forbid_update_delete();
create trigger rule_set_version_items_append_only
  before update or delete on rule_set_version_items
  for each row execute function forbid_update_delete();
create trigger fee_schedule_versions_append_only
  before update or delete on fee_schedule_versions
  for each row execute function forbid_update_delete();

revoke all on source_revisions, source_revision_reviews, coverage_records,
  rule_set_versions, rule_set_version_items, fee_schedule_versions
  from anon, authenticated, service_role;

grant select, insert on source_revisions, source_revision_reviews, coverage_records,
  rule_set_versions, rule_set_version_items, fee_schedule_versions
  to authenticated, service_role;
