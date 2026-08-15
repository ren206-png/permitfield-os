-- Rollback for 20260806000019_lifecycle_intake_properties_clients_taxonomies.sql
-- create_organization_with_owner is restored to its pre-this-migration body
-- (from 20260806000002) via CREATE OR REPLACE -- it must NOT be dropped,
-- since migration 20260806000002 originally created it and still owns that
-- contract; this migration only replaced its body in place. Table drop order
-- is FK-child-first: projects references clients/properties/contractors/
-- taxonomies, so it goes first; properties references clients, so it goes
-- before clients; taxonomies has no remaining dependents once projects is
-- gone. The contractors_org_id_id_key unique constraint added to the
-- pre-existing contractors table is dropped last.

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
  return new_org_id;
end;
$$;

revoke select, insert, update on projects from service_role;
revoke select, insert, update on properties from service_role;
revoke select, insert, update on clients from service_role;
revoke select, insert, update on taxonomies from service_role;

revoke select, insert, update on projects from authenticated;
revoke select, insert, update on properties from authenticated;
revoke select, insert, update on clients from authenticated;
revoke select, insert, update on taxonomies from authenticated;

drop policy if exists projects_update on projects;
drop policy if exists projects_insert on projects;
drop policy if exists projects_select on projects;
drop policy if exists properties_update on properties;
drop policy if exists properties_insert on properties;
drop policy if exists properties_select on properties;
drop policy if exists clients_update on clients;
drop policy if exists clients_insert on clients;
drop policy if exists clients_select on clients;
drop policy if exists taxonomies_update on taxonomies;
drop policy if exists taxonomies_insert on taxonomies;
drop policy if exists taxonomies_select on taxonomies;

drop table if exists projects;
drop table if exists properties;
drop table if exists clients;
drop table if exists taxonomies;

drop type if exists project_status;

alter table contractors drop constraint if exists contractors_org_id_id_key;
