-- Lifecycle & Compliance Expansion, Phase 1.0: "Tenancy + RBAC + audit ledger
-- foundation" (flag permitfield_lifecycle_core). Additive-only against the
-- Phase 1-5 schema: no existing column, row, or enum value is renamed or
-- removed. See PHASE_0_FINDINGS.md SS I #3 for why this shape was chosen.
--
-- org_role is extended, not replaced. A `RENAME VALUE` from 'owner' to
-- 'org_owner' was considered and rejected: enum label renames aren't
-- flag-gatable (there is no "old label" left for flags-off code to keep
-- reading), which would break the global "flags off => byte-for-byte
-- identical behavior" rule this repo has followed since Phase 1. Instead,
-- 'owner'/'member' are left completely untouched and 8 new values are added
-- alongside them. lib/authz/index.ts's Role type is a superset that includes
-- both the legacy two and the new eight; nothing forces existing rows to
-- adopt a new value.
--
-- IMPORTANT (see docs/PERMISSIONS.md and the Phase 1.0 report's "What's NOT
-- done" section): adding these enum values changes zero RLS behavior by
-- itself. Every existing policy in this schema still only branches on
-- is_org_member()/is_org_owner(), and is_org_owner() still only recognizes
-- the literal 'owner' value. A member row created with, say, 'permit_manager'
-- is a full org member (is_org_member) but NOT an owner (is_org_owner) for
-- every table this project has today. Enforcement of the new roles happens
-- only where application code explicitly calls lib/authz's can(), starting
-- in a later phase once routes exist to call it from. This migration is
-- schema-only foundation, not a behavior change.
alter type org_role add value if not exists 'platform_admin';
alter type org_role add value if not exists 'org_owner';
alter type org_role add value if not exists 'permit_manager';
alter type org_role add value if not exists 'permit_coordinator';
alter type org_role add value if not exists 'document_reviewer';
alter type org_role add value if not exists 'applicant_contractor';
alter type org_role add value if not exists 'client_user';
alter type org_role add value if not exists 'auditor_readonly';

-- audit_logs: an append-only ledger of tenant-scoped actions, independent of
-- and additional to the domain-specific append-only tables that already
-- exist (extractions, audits, audit_findings, generated_documents). Those
-- tables record *what the AI produced*; audit_logs records *what a human (or
-- a background job acting on a human's behalf) did* -- e.g. "user X
-- confirmed finding Y", "user X submitted application Z". Modeled on
-- extractions' append-only pattern (20260806000007): a SELECT-only RLS
-- policy plus an INSERT policy, no UPDATE/DELETE policy at all (RLS default-
-- denies both), and the same forbid_update_delete() trigger reused as a
-- second, storage-engine-level backstop that also blocks service_role
-- (which has BYPASSRLS and would otherwise sail past the RLS layer -- see
-- 20260806000015's header comment for why that distinction matters here).
--
-- Nothing in the current codebase calls this table yet (lib/audit/log.ts is
-- infrastructure, not wired into any existing route in this phase) -- see
-- the Phase 1.0 report. Its existence with zero writers does not change any
-- existing behavior.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  actor_role org_role not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_summary jsonb,
  after_summary jsonb,
  ip inet,
  user_agent text,
  occurred_at timestamptz not null default now()
);

create index audit_logs_org_id_occurred_at_idx on audit_logs (org_id, occurred_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);

alter table audit_logs enable row level security;

-- Deliberately more restrictive than plain org membership: an audit ledger
-- that every member can browse defeats part of its own purpose (e.g. a
-- permit_coordinator should not be able to read a log entry describing
-- another coordinator's actions). Scoped to roles that plausibly need
-- oversight visibility. 'owner' (legacy) and 'org_owner' (new) both included
-- since a legacy-role org has no other way to reach this data.
create or replace function can_read_audit_logs(check_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- plpgsql (not sql) so the body is not parsed at CREATE FUNCTION time --
  -- this function references enum values added by an ALTER TYPE in this
  -- same migration, which are not visible to the SQL parser until commit.
  -- Do not convert to language sql.
  return exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner', 'platform_admin', 'auditor_readonly')
  );
end;
$$;

revoke all on function can_read_audit_logs(uuid) from public;
grant execute on function can_read_audit_logs(uuid) to authenticated;

create policy audit_logs_select on audit_logs
  for select to authenticated
  using (can_read_audit_logs(org_id));

-- Any org member may write a log entry describing their OWN action -- this
-- is intentionally broader than audit_logs_select (SS: everyone can generate
-- a paper trail about themselves; not everyone can browse everyone else's).
-- actor_user_id = auth.uid() prevents one member from forging a log entry
-- attributed to another.
create policy audit_logs_insert on audit_logs
  for insert to authenticated
  with check (is_org_member(org_id) and actor_user_id = auth.uid());

-- No UPDATE/DELETE policy for `authenticated` -- RLS denies both by default,
-- same as extractions/audits. Table-level GRANT below still includes
-- update/delete so that denial surfaces as this trigger's explicit error
-- rather than a generic permission-denied (matching 20260806000011's
-- documented reasoning: a specific error should not leak which enforcement
-- layer caught it as a bug does).
create trigger audit_logs_append_only
  before update or delete on audit_logs
  for each row execute function forbid_update_delete();

grant select, insert, update, delete on audit_logs to authenticated;

-- Proactive service_role grant, added now rather than discovered live later --
-- this repo has already hit the "service_role has BYPASSRLS but zero table
-- grants of its own" bug twice (20260806000015's header comment). No
-- background job writes to audit_logs yet, but when one does (a future
-- phase), it will not need a follow-up migration just to grant table access.
grant select, insert on audit_logs to service_role;
