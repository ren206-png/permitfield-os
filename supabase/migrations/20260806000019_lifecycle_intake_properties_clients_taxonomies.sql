-- Lifecycle & Compliance Expansion, Phase 1.1: "Project intake" (flag
-- permitfield_ff_intake). Four new org-scoped tables -- taxonomies, clients,
-- properties, projects -- additive against every prior migration, same
-- discipline as 20260806000018: no existing column, row, or enum value is
-- renamed or removed.
--
-- Composite-FK cross-org prevention (SS3.1 "composite FKs or check
-- constraints... application-layer checking is insufficient"): every new
-- table that references another org-scoped table does so via a composite
-- foreign key against that table's own `(org_id, id)` pair, not a bare `id`
-- FK. This is the same pattern org_members already uses for its
-- `unique (org_id, user_id)` constraint, generalized to entity references.
-- Concretely: `projects.client_id` cannot point at a client row belonging to
-- a different org, because the FK is `(org_id, client_id) references
-- clients (org_id, id)` -- a forged cross-org id fails the FK constraint
-- itself, at the database layer, independent of and prior to any RLS check.
-- This closes a gap the Phase 1.0 report left open: `permit_applications`
-- (20260806000006) references `contractors`/`permit_types` via bare-id FKs
-- with no composite guard, relying on RLS alone. That gap is NOT retrofixed
-- here (retrofitting an existing table's FK shape is out of scope for an
-- additive-only phase and belongs in its own migration) but the pattern
-- below is now available for that future migration to reuse. `contractors`
-- gets the `unique (org_id, id)` half of the pattern added now (additive,
-- harmless with zero behavior change) specifically so `projects.contractor_id`
-- can use it.
--
-- Archival, not deletion (global engineering rule, PHASE_0_FINDINGS.md SS F):
-- every table below gets `archived_at timestamptz`, and NONE of them has a
-- DELETE policy or DELETE grant -- unlike `contractors`/`permit_applications`
-- (Phase 1, hard deletes, predates this rule being made explicit). RLS
-- deliberately does NOT restrict SELECT to unarchived rows: archival is a
-- workflow/visibility concern for application code to filter by default, not
-- a security boundary -- an archived project's history should stay
-- inspectable by any org member who could see it before archival, same as
-- nothing else about org membership changed. `lib/authz`'s `archive` Action
-- maps to a plain UPDATE (setting archived_at) here, same as it does
-- everywhere else this phase touches -- RLS cannot distinguish "update
-- archived_at" from "update title" within a single UPDATE policy, so, same
-- as `permit_applications_update`, one `is_org_member`-gated UPDATE policy
-- covers both intents; no route calls `can()` to distinguish them yet
-- either (see lib/authz's own header comment).
--
-- No `updated_at`-maintaining trigger: matches every existing table in this
-- schema (contractors, permit_applications, ...) -- grep-confirmed zero
-- BEFORE UPDATE triggers exist anywhere in supabase/migrations/ today.
-- `updated_at` is set explicitly by the calling Server Action, same
-- convention as the rest of the codebase, not invented fresh here.

-- contractors: add the `(org_id, id)` half of the composite-FK pattern so
-- projects.contractor_id (below) can reference it safely. Purely additive --
-- a new unique index, zero behavior change to any existing query or policy.
alter table contractors add constraint contractors_org_id_id_key unique (org_id, id);

-- taxonomies: per-org classification lookup (e.g. project type/category).
-- `kind` is a plain text discriminator rather than its own enum -- this
-- phase only seeds one kind ('project_type', see the RPC extension below),
-- but a text column lets a later phase add a second kind (e.g. a permit
-- category taxonomy) without an enum migration. `is_seed` distinguishes
-- rows `create_organization_with_owner()` populated automatically from ones
-- an org creates itself, so a future "reset to defaults" or "hide seed
-- taxonomy the org never uses" feature can tell them apart without guessing
-- from `code`/`label` text.
create table taxonomies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  code text not null,
  label text not null,
  sort_order int not null default 0,
  is_seed boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, kind, code)
);

-- clients: the org's own customer relationship (e.g. a homeowner or business
-- who hired the org's contractor). Deliberately a full entity (not a plain
-- text field on projects) since a client is commonly reused across multiple
-- projects over time and the master prompt's scoping calls for a real
-- clients table -- unlike `property_owner`/`applicant` on `projects` below,
-- which stay plain text per this phase's explicit scoping decision (see the
-- Phase 1.1 report): those two describe roles on a specific permit filing
-- that may or may not be the same person/entity as the client of record, and
-- building full Contact entities for both was judged out of scope for this
-- gate.
create table clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

-- properties: a physical address the org files permits against. Canadian
-- address shape only (SS0.5: no US-specific terminology pre-emptively) --
-- `province_code` reuses contractors.license_province_code's naming
-- (20260806000003) for consistency, and is DB-constrained only to "2 letters,
-- uppercase" here; the full Canadian province/territory enum + postal code
-- format validation lives in lib/intake/schemas.ts (Zod), not duplicated as
-- a Postgres CHECK -- same division of labor the rest of this codebase uses
-- (DB constraints catch structural corruption; Zod owns business-rule
-- validation with actually-good error messages).
create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  province_code text not null check (province_code = upper(province_code) and length(province_code) = 2),
  postal_code text not null,
  legal_description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references clients (org_id, id)
);

-- project_status: a simple 5-value workflow enum, deliberately distinct from
-- Gate 1.3's future full compliance-lifecycle state machine (that gate is
-- expected to model permit-filing status, inspections, approvals, etc. in
-- much finer detail) -- this is just "where is this project in the org's own
-- pipeline", scoped narrowly so Gate 1.3 is free to design its own model
-- without this phase's enum constraining it.
create type project_status as enum ('draft', 'active', 'on_hold', 'completed', 'archived');

-- projects: the central intake entity this gate exists to create. All three
-- entity references (client, property, contractor) are nullable -- a project
-- can be created before its client/property/contractor is known and filled
-- in later, matching how a real intake conversation actually happens (SS: a
-- coordinator often opens a project file before every detail is confirmed).
-- `contractor_id` reuses the existing `contractors` table (20260806000003)
-- rather than introducing a new entity, per this phase's explicit scoping
-- decision -- a project's filing contractor is the same kind of row
-- `permit_applications.contractor_id` already points at.
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid,
  property_id uuid,
  contractor_id uuid,
  taxonomy_id uuid,
  title text not null,
  description text,
  -- Plain text, not FKs -- see the clients table's comment above for why
  -- these two stay text fields in this gate rather than becoming entities.
  property_owner_name text,
  applicant_name text,
  status project_status not null default 'draft',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references clients (org_id, id),
  foreign key (org_id, property_id) references properties (org_id, id),
  foreign key (org_id, contractor_id) references contractors (org_id, id),
  foreign key (org_id, taxonomy_id) references taxonomies (org_id, id)
);

create index taxonomies_org_id_idx on taxonomies (org_id);
create index clients_org_id_idx on clients (org_id);
create index properties_org_id_idx on properties (org_id);
create index properties_client_id_idx on properties (org_id, client_id);
create index projects_org_id_idx on projects (org_id);
create index projects_client_id_idx on projects (org_id, client_id);
create index projects_property_id_idx on projects (org_id, property_id);
create index projects_contractor_id_idx on projects (org_id, contractor_id);
create index projects_taxonomy_id_idx on projects (org_id, taxonomy_id);

alter table taxonomies enable row level security;
alter table clients enable row level security;
alter table properties enable row level security;
alter table projects enable row level security;

-- taxonomies: read by any member; write restricted to owners (legacy
-- 'owner' or new 'org_owner') since a taxonomy is org-wide shared
-- configuration, not a per-record working set -- closer to org_members in
-- shape (owner-managed roster/config) than to contractors/projects
-- (member-managed working records). is_org_owner() only recognizes the
-- literal 'owner' value (20260806000002 L43-54); 'org_owner' rows are, at
-- this DB layer, ordinary members until a later phase teaches is_org_owner()
-- about the new value or replaces it with lib/authz's can() -- documented
-- here so this policy doesn't silently drift from that known limitation.
create policy taxonomies_select on taxonomies
  for select to authenticated
  using (is_org_member(org_id));

create policy taxonomies_insert on taxonomies
  for insert to authenticated
  with check (is_org_owner(org_id));

create policy taxonomies_update on taxonomies
  for update to authenticated
  using (is_org_owner(org_id))
  with check (is_org_owner(org_id));

-- clients / properties / projects: mirrors contractors'
-- select/insert/update shape (20260806000003) -- any org member can read,
-- create, and update. No delete policy on any of the three (see this
-- migration's header comment on archival-not-deletion).
create policy clients_select on clients
  for select to authenticated
  using (is_org_member(org_id));

create policy clients_insert on clients
  for insert to authenticated
  with check (is_org_member(org_id));

create policy clients_update on clients
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy properties_select on properties
  for select to authenticated
  using (is_org_member(org_id));

create policy properties_insert on properties
  for insert to authenticated
  with check (is_org_member(org_id));

create policy properties_update on properties
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy projects_select on projects
  for select to authenticated
  using (is_org_member(org_id));

create policy projects_insert on projects
  for insert to authenticated
  with check (is_org_member(org_id));

create policy projects_update on projects
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

-- No DELETE policy and no DELETE grant on any of the four tables below --
-- RLS default-denies DELETE with no policy present, and omitting the GRANT
-- too means that denial surfaces consistently (unlike audit_logs, these
-- tables have no forbid_update_delete() trigger to produce a more specific
-- error -- a plain permission-denied is the correct, only signal here, since
-- "you may never delete this row" is not a distinct enforcement layer worth
-- a bespoke error the way append-only-ledger semantics are).
grant select, insert, update on taxonomies to authenticated;
grant select, insert, update on clients to authenticated;
grant select, insert, update on properties to authenticated;
grant select, insert, update on projects to authenticated;

-- Proactive service_role grants, same reasoning as 20260806000018's tail
-- comment: no background job touches these tables yet in this phase, but
-- this repo has hit the "service_role has BYPASSRLS but zero grants of its
-- own" bug twice already (20260806000015's header comment) -- granting now
-- means the day a job needs to read/write intake data, it doesn't need a
-- follow-up migration just for table access.
grant select, insert, update on taxonomies to service_role;
grant select, insert, update on clients to service_role;
grant select, insert, update on properties to service_role;
grant select, insert, update on projects to service_role;

-- Seed default taxonomies for every NEW org going forward. `create or
-- replace function` against the existing create_organization_with_owner()
-- (20260806000002) -- additive per this repo's function-versioning
-- convention (e.g. 20260806000014 did the same to add hybrid retrieval),
-- not a new function, so every existing call site keeps working unchanged.
-- The five rows below (`project_type` taxonomy) are this phase's own
-- product decision for a sensible construction/permitting default set, not
-- sourced from the master prompt's own text. Existing orgs (Org A/B test
-- fixtures) do NOT get these retroactively via this function change alone --
-- see supabase/seed.sql's own update for that backfill.
create or replace function create_organization_with_owner(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role) values (new_org_id, auth.uid(), 'owner');

  insert into taxonomies (org_id, kind, code, label, sort_order, is_seed) values
    (new_org_id, 'project_type', 'new_construction', 'New Construction', 1, true),
    (new_org_id, 'project_type', 'renovation', 'Renovation', 2, true),
    (new_org_id, 'project_type', 'addition', 'Addition', 3, true),
    (new_org_id, 'project_type', 'repair', 'Repair', 4, true),
    (new_org_id, 'project_type', 'demolition', 'Demolition', 5, true);

  return new_org_id;
end;
$$;
