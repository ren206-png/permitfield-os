-- Rollback for 20260806000040_org_subscriptions.sql
-- Restores create_organization_with_owner() to its pre-org_subscriptions
-- body (20260806000002...sql, verbatim), then drops the new table (which
-- cascades its own policy and indexes, same "dropping the table cascades
-- its own policies" reasoning as 20260806000003's own rollback) and the two
-- new enum types.
--
-- Restoring the original function body is a data-loss-adjacent step worth
-- calling out explicitly: once rolled back, a *new* org created against
-- this state gets no org_subscriptions row at all (matching this
-- codebase's pre-billing-build behavior exactly), while any
-- org_subscriptions rows already written for orgs created *before* the
-- rollback are removed by the DROP TABLE below along with everything else
-- -- there is no partial/soft rollback of this migration, same "rollbacks
-- are only safe applied in strict reverse order against the exact state
-- the migration after them left behind" caveat this directory's own
-- README documents.

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

drop policy if exists org_subscriptions_select on org_subscriptions;
drop table if exists org_subscriptions;
drop type if exists org_subscription_status;
drop type if exists org_subscription_tier;
