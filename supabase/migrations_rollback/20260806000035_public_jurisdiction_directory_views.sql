-- Rollback for 20260806000035_public_jurisdiction_directory_views.sql
-- Drops the two curated views (and, with them, the grants issued on the
-- views themselves) and restores exactly the base-table grants/policies
-- this migration revoked/dropped -- i.e. puts the schema back to the state
-- 20260806000034 left it in, so that migration's own rollback (which runs
-- immediately after this one in the strict reverse-order walk) has the
-- state it expects to undo.

revoke select on public_permit_types from anon, service_role;
revoke select on public_jurisdictions from anon, service_role;

drop view if exists public_permit_types;
drop view if exists public_jurisdictions;

grant select on jurisdictions to anon;
grant select on permit_types to anon;
grant select on authorities to anon;

create policy jurisdictions_select_anon on jurisdictions
  for select to anon
  using (true);

create policy authorities_select_anon on authorities
  for select to anon
  using (true);

create policy permit_types_select_anon on permit_types
  for select to anon
  using (true);
