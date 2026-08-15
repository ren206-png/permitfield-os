-- Rollback for 20260806000002_organizations_and_members.sql
-- Reverse dependency order: policies must go before the functions they call
-- in their USING/WITH CHECK clauses (is_org_member/is_org_owner), and both
-- `language sql` functions must go before the tables they query, since
-- Postgres records a pg_depend entry for tables referenced in a SQL-language
-- function body -- dropping org_members while is_org_member() still exists
-- would fail with "cannot drop table ... because other objects depend on
-- it". org_members is dropped before organizations (FK child before
-- parent). Valid only when applied immediately after this migration with no
-- later migration present.

drop policy if exists org_members_delete on org_members;
drop policy if exists org_members_update on org_members;
drop policy if exists org_members_insert on org_members;
drop policy if exists org_members_select on org_members;
drop policy if exists organizations_update on organizations;
drop policy if exists organizations_select on organizations;

drop function if exists create_organization_with_owner(text);
drop function if exists is_org_owner(uuid);
drop function if exists is_org_member(uuid);

drop table if exists org_members;
drop table if exists organizations;

drop type if exists org_role;
