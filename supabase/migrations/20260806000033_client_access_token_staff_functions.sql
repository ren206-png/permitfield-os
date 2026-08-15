-- Gate 2.0 sub-phase 2.6: staff-facing client_access_token issuance/
-- revocation authorization (GATE_2_0_SPEC.md §7 item 2; scoped and
-- reviewed in GATE_2_0_FINDINGS.md §O before this branch, approved as
-- "APPROVED: PHASE 2.6").
--
-- Closes O.1 (the is_org_owner() gap) via option (b): a new, narrow,
-- purpose-built check per operation, not a widening of is_org_owner()
-- itself. is_org_owner() (20260806000002:43-54) still checks only the
-- literal 'owner' value and is untouched here -- every existing policy
-- that already depends on it keeps depending on exactly what it depended
-- on yesterday. Widening it was rejected for the identical reason
-- 20260806000021 rejected it for platform_admin: a behavior change to
-- every table it already gates (organizations_update, org_members_*,
-- contractors_delete, permit_applications_delete, taxonomies_*,
-- readiness_checklist_items delete), not an additive one.
--
-- Two functions, not one, because the tiers are deliberately different
-- (explicit instruction, approving §O's O.1 finding): issuing a client
-- access credential is a narrower power than revoking one. A
-- permit_manager may need to shut off a link (e.g. an application was
-- pulled, a client relationship ended) without also being trusted to
-- mint new external access on their own initiative.
--
--   can_issue_client_access_token(org_id)  -> owner, org_owner
--   can_revoke_client_access_token(org_id) -> owner, org_owner, permit_manager
--
-- Both follow can_read_audit_logs()'s shape exactly
-- (20260806000018:78-97): security definer, stable, checks org_members
-- for auth.uid() within the given org. `language sql` (not plpgsql) is
-- correct here, not an oversight -- all eight additive org_role values
-- were already committed in 20260806000018, so unlike
-- can_read_audit_logs() (written in the same migration that added the
-- enum values it references) there is no same-transaction visibility
-- problem for this migration to work around. Noted so a future author
-- doesn't "fix" this to plpgsql for no reason.
--
-- Note on GATE_2_0_SPEC.md §1's own transition matrix (line 96): it
-- previously described the revocation tier as "owner/org_owner/
-- platform_admin", which both predates this decision and does not match
-- it -- platform_admin is a cross-org staff role (is_platform_admin(),
-- 20260806000021), not an org-scoped tier, and was never actually wired
-- to org-scoped revocation anywhere. This migration implements the
-- tiers as explicitly decided for 2.6 (owner/org_owner for issuance;
-- owner/org_owner/permit_manager for revocation) and GATE_2_0_SPEC.md
-- §1 is corrected in this same branch to match, rather than left
-- silently inconsistent with the code that now exists.
create or replace function can_issue_client_access_token(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner')
  );
$$;

revoke all on function can_issue_client_access_token(uuid) from public;
grant execute on function can_issue_client_access_token(uuid) to authenticated;

create or replace function can_revoke_client_access_token(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner', 'permit_manager')
  );
$$;

revoke all on function can_revoke_client_access_token(uuid) from public;
grant execute on function can_revoke_client_access_token(uuid) to authenticated;
