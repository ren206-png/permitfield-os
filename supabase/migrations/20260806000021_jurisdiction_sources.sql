-- Lifecycle & Compliance Expansion, Phase 1.2: "Jurisdiction directory +
-- source verification model" (flag permitfield_jurisdictions). Additive-only
-- against every prior migration: no existing column, row, or enum value is
-- renamed, retyped, or removed.
--
-- Master prompt SS3.3's "fields per the brief" for jurisdictions/authorities
-- (country, province_code, municipality, region, portal_url, coverage_level,
-- verified_at / name, authority_level, province_code, jurisdiction_id,
-- portal_url, filing_mechanism) already exist verbatim in
-- 20260806000004_jurisdictions_and_authorities.sql. This gate's actual net-
-- new surface is the one thing that migration does NOT have: a per-source
-- verification record. jurisdictions.verified_at is a single timestamp for
-- the whole jurisdiction row; SS3.3 requires "one jurisdiction has many
-- sources (fee schedule, processing times, forms page, bylaw)", each
-- independently verifiable. That's jurisdiction_sources below.
--
-- ---------------------------------------------------------------------------
-- PLATFORM_ADMIN GAP (flagged per SS0.1 rule 8 -- not silently resolved):
-- SS3.3's `verified_by` field implies a verification workflow gated to
-- PermitField's own staff, not any org member. Phase 1.0
-- (20260806000018) added the `platform_admin` org_role value and
-- documented, in its own header comment and in docs/PERMISSIONS.md's
-- "Current status" section, that assigning it to a real org_members row
-- today has ZERO effect at the RLS layer for every table that predates this
-- migration -- every existing policy branches only on is_org_member()/
-- is_org_owner(), neither of which recognizes 'platform_admin' by name. The
-- one and only precedent for an RLS policy that DOES check an elevated role
-- by name is can_read_audit_logs() (20260806000018 L79-91), which inlines
-- `role in ('owner','org_owner','platform_admin','auditor_readonly')`
-- directly in a SECURITY DEFINER function rather than widening
-- is_org_owner()'s definition (that would have been a *behavior change* to
-- every table is_org_owner() already gates, which is not additive).
--
-- This migration follows that exact precedent rather than inventing a new
-- one: is_platform_admin() below is a new, narrow, org-agnostic sibling of
-- is_org_member()/is_org_owner() (jurisdictions are global, not org-scoped,
-- so there is no check_org_id to parameterize on), used only by
-- jurisdiction_sources' write policies and the verify_jurisdiction_source()
-- RPC. It does not touch is_org_owner(), does not change what any existing
-- table's RLS does, and does not retrofit lib/auth/org-context.ts's
-- `OrgContext.role: 'owner' | 'member'` type (that file has no call site in
-- this gate -- jurisdiction_sources ships with zero UI/Server Action, see
-- the Gate 1.2 report's "What is NOT done" section). Wiring a route to
-- actually let a platform_admin user reach verify_jurisdiction_source() is
-- explicitly deferred, same as audit_logs' writeAuditLog() shipped with zero
-- callers in Phase 1.0.
-- ---------------------------------------------------------------------------

-- 'other' follows the same extensibility precedent as doc_kind
-- (20260806000006 L33) -- SS3.3 lists four source kinds as examples
-- ("fee schedule, processing times, forms page, bylaw"), not an exhaustive
-- set; a fifth kind should not require a migration just to be storable.
create type jurisdiction_source_type as enum (
  'fee_schedule',
  'processing_times',
  'forms_page',
  'bylaw',
  'other'
);

-- Exact five values from SS3.3, no more, no less.
create type jurisdiction_source_verification_status as enum (
  'unverified',
  'pending_review',
  'verified',
  'stale',
  'disputed'
);

-- One row per source document/page a jurisdiction's requirements are backed
-- by. jurisdiction_id references the *jurisdiction*, not a specific
-- authority, because SS3.3 groups sources under "a jurisdiction has many
-- sources" -- an authority-level source is out of scope for this gate (no
-- authority_id column here; add one additively in a later gate if the brief
-- turns out to need it, rather than guessing now).
--
-- verified_by/verified_at record the identity and timestamp of the most
-- recent verification ACTION taken on this row (via verify_jurisdiction_source
-- below), regardless of what verification_status that action resulted in --
-- e.g. a reviewer who marks a source 'disputed' after checking it is still
-- the "responsible internal reviewer" SS3.3 requires be renderable, not just
-- reviewers who happened to approve. The check constraint below only
-- requires both be non-null when the status is 'verified' -- disputing or
-- putting a never-reviewed source into pending_review does not require a
-- reviewer identity to already exist.
--
-- No archived_at DELETE policy/grant is added for `authenticated` (global
-- archival-not-deletion rule, same as taxonomies/clients/properties/projects
-- in 20260806000019) -- archived_at exists so a source can be retired
-- without losing its verification history, but this gate ships no call site
-- that sets it (same "schema exists, nothing writes to it yet" pattern as
-- audit_logs in Phase 1.0).
create table jurisdiction_sources (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  source_type jurisdiction_source_type not null,
  url text not null,
  retrieved_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  verification_status jurisdiction_source_verification_status not null default 'unverified',
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- DB-enforced (not left to application code, per SS0.3's posture on
  -- unverified data): a row cannot claim 'verified' without both a reviewer
  -- and a timestamp. This is the Gate-1.2-scoped sibling of SS3.4's stricter
  -- permit_requirement constraint (verified_at/verified_by/source_id all
  -- required) -- that one is Gate 1.6 scope (permit_requirement doesn't
  -- exist yet); this is the same shape applied one gate early, to the table
  -- SS3.4's future constraint will eventually reference via source_id.
  constraint jurisdiction_sources_verified_requires_reviewer check (
    verification_status <> 'verified'
    or (verified_by is not null and verified_at is not null)
  )
);

create index jurisdiction_sources_jurisdiction_id_idx on jurisdiction_sources (jurisdiction_id);

alter table jurisdiction_sources enable row level security;

-- Org-agnostic sibling of is_org_member()/is_org_owner() (20260806000002
-- L30-54) and the same SECURITY DEFINER shape as can_read_audit_logs()
-- (20260806000018 L79-91) -- see this file's header comment for why a new
-- function was added here instead of widening is_org_owner(). No check_org_id
-- parameter: platform_admin is modeled as PermitField staff, not scoped to
-- any one org, and jurisdiction_sources is global reference data like
-- jurisdictions/authorities themselves (20260806000004), not an org-scoped
-- table -- there is no org_id anywhere in this migration to check against.
create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where user_id = auth.uid() and role = 'platform_admin'
  );
$$;

revoke all on function is_platform_admin() from public;
grant execute on function is_platform_admin() to authenticated;

-- Reference data, same shape as jurisdictions_select/authorities_select
-- (20260806000004 L47-53): readable by any authenticated user regardless of
-- org, since every org needs to be able to browse the same jurisdiction
-- directory. Unlike jurisdictions/authorities (service_role-only write),
-- jurisdiction_sources is writable by `authenticated` platform_admin users
-- directly -- SS3.3's verified_by/verification_status workflow is a human
-- (PermitField staff) action taken from a live session, not a
-- backend/ingestion-only write.
create policy jurisdiction_sources_select on jurisdiction_sources
  for select to authenticated
  using (true);

create policy jurisdiction_sources_insert on jurisdiction_sources
  for insert to authenticated
  with check (is_platform_admin());

-- with check additionally forbids setting verified_by to anyone but the
-- caller themselves (or clearing it to null) -- same forged-actor defense as
-- audit_logs_insert's `actor_user_id = auth.uid()` (20260806000018 L95-98),
-- applied here to UPDATE instead of INSERT since verified_by is set by
-- edits, not row creation. This is defense-in-depth for direct
-- PostgREST/table-client edits; the sanctioned path for the verify action
-- itself is verify_jurisdiction_source() below, which never accepts a
-- caller-supplied verified_by at all.
create policy jurisdiction_sources_update on jurisdiction_sources
  for update to authenticated
  using (is_platform_admin())
  with check (is_platform_admin() and (verified_by is null or verified_by = auth.uid()));

-- No DELETE policy -- archival-only, same global rule as
-- taxonomies/clients/properties/projects (20260806000019).

grant select, insert, update on jurisdiction_sources to authenticated;
-- Proactive service_role grant (BYPASSRLS has no table privileges of its
-- own -- see 20260806000015's header comment for why this repo grants this
-- up front rather than discovering the gap live). No background job writes
-- to jurisdiction_sources yet; this covers the ingestion/seeding path a
-- later phase will add without a follow-up migration.
grant select, insert, update on jurisdiction_sources to service_role;

-- Sanctioned write path for the verification action specifically (same
-- pattern as create_organization_with_owner /
-- create_project_with_intake): does its own explicit is_platform_admin()
-- check as its first statement, since SECURITY DEFINER bypasses
-- jurisdiction_sources' own RLS policies entirely. verified_by is always
-- auth.uid() -- there is no p_verified_by parameter, so this function has no
-- forgery vector at all (stronger than the base UPDATE policy's with-check,
-- which only catches direct table edits).
--
-- p_notes/p_clear_notes: SQL's null carries no "caller passed nothing" vs.
-- "caller wants this cleared" distinction on its own, so a bare
-- `notes = coalesce(p_notes, notes)` (this function's original Gate 1.2
-- shape) had no way to ever clear an existing note back to null -- flagged
-- as a known limitation in the Gate 1.2 report and fixed here, before this
-- migration has any caller, rather than left for a future gate to work
-- around. p_clear_notes defaults to false (preserve existing notes when
-- omitted, same default behavior as before for every existing call), and
-- must be passed explicitly true to clear -- p_notes is ignored when it is.
create or replace function verify_jurisdiction_source(
  p_source_id uuid,
  p_status jurisdiction_source_verification_status,
  p_notes text default null,
  p_clear_notes boolean default false
)
returns jurisdiction_sources
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row jurisdiction_sources;
begin
  if not is_platform_admin() then
    raise exception 'insufficient_privilege: only platform_admin may verify jurisdiction sources';
  end if;

  update jurisdiction_sources
  set verification_status = p_status,
      verified_by = auth.uid(),
      verified_at = now(),
      notes = case
        when p_clear_notes then null
        else coalesce(p_notes, notes)
      end,
      updated_at = now()
  where id = p_source_id
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'jurisdiction_source % not found', p_source_id;
  end if;

  return updated_row;
end;
$$;

revoke all on function verify_jurisdiction_source(uuid, jurisdiction_source_verification_status, text, boolean) from public;
grant execute on function verify_jurisdiction_source(uuid, jurisdiction_source_verification_status, text, boolean) to authenticated;

-- SS3.3: "Staleness is automatic ... a verified source older than a
-- configurable threshold (default 180 days) is computed as stale and must
-- render with a visible warning. Do not require a human to notice." A
-- background job flipping the stored verification_status column on a
-- schedule was considered and rejected: no scheduled-job infrastructure
-- decision exists anywhere in this repo yet (grep-verified: no cron, no
-- pg_cron extension enabled, no Inngest cron function), so staleness would
-- either require inventing that infrastructure in this gate (out of scope --
-- SS3.3 does not ask for a job, it asks for a computed result) or drift
-- silently between runs (the exact "requires a human to notice" failure
-- mode SS3.3 explicitly forbids). Computing it at read time instead means it
-- is *never* wrong, by construction -- there is no window where a stored
-- 'verified' row is actually 180+ days old and still displays as 'verified'.
--
-- STABLE (not IMMUTABLE, since it reads now()), plain SQL (no table access,
-- so no SECURITY DEFINER needed -- any authenticated caller can already read
-- the two columns this takes as arguments via jurisdiction_sources_select
-- above). threshold_days defaults to SS3.3's literal 180 but is a parameter,
-- not a constant, so a future per-org or per-jurisdiction override does not
-- require redefining this function.
--
-- This does NOT rewrite the stored verification_status column -- a row that
-- has gone stale still reads 'verified' from a bare `select * from
-- jurisdiction_sources`. Every call site that renders verification_status to
-- a user MUST call this function (or the mirrored pure TypeScript function,
-- lib/jurisdictions/staleness.ts's computeEffectiveVerificationStatus) to get
-- the *effective* status, not read the column directly -- see that file's
-- header comment and the Gate 1.2 report SS9 for why no such call site exists
-- yet in this gate.
create or replace function jurisdiction_source_effective_status(
  p_verification_status jurisdiction_source_verification_status,
  p_verified_at timestamptz,
  p_threshold_days integer default 180
)
returns jurisdiction_source_verification_status
language sql
stable
as $$
  select case
    when p_verification_status = 'verified'
         and p_verified_at is not null
         and p_verified_at < now() - (p_threshold_days || ' days')::interval
    then 'stale'::jurisdiction_source_verification_status
    else p_verification_status
  end;
$$;

grant execute on function jurisdiction_source_effective_status(jurisdiction_source_verification_status, timestamptz, integer)
  to authenticated, service_role;
