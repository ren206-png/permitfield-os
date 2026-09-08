-- Health-check follow-up: three foreign-key columns that are queried/joined
-- on frequently but never got an index in their own migration.
--
-- org_members.user_id: requireOrgContext() (lib/auth/org-context.ts) runs
-- `select ... from org_members where user_id = auth.uid()` on every single
-- (app) route's server-side render -- the highest-traffic query in this
-- codebase. The only index on org_members is the `unique (org_id, user_id)`
-- composite from 20260806000002, which can't serve a user_id-only lookup
-- (user_id isn't the leftmost column), so this was a full table scan on
-- every page load.
--
-- contractors.org_id: every contractors query (RLS's is_org_member(org_id)
-- check, plus direct .eq('org_id', ...) reads in
-- app/(app)/applications/new/page.tsx and app/admin/page.tsx) filters on
-- this column; 20260806000003 created the FK but no index, unlike
-- permit_applications.org_id (20260806000006) which got one in the same
-- migration that created the table.
--
-- permit_types.jurisdiction_id: same gap as the above, lower traffic but
-- free to fix alongside it -- 20260806000005 indexed permit_type_filings'
-- and permit_form_fields' FK columns but not permit_types' own
-- jurisdiction_id.
create index org_members_user_id_idx on org_members (user_id);
create index contractors_org_id_idx on contractors (org_id);
create index permit_types_jurisdiction_id_idx on permit_types (jurisdiction_id);
