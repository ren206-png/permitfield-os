-- Rollback for 20260806000042_org_subscriptions_event_ordering.sql
-- Drops the stripe_event_created_at column. Pure column removal, no other
-- object depends on it (not indexed, not referenced by any RLS policy or
-- grant).

alter table org_subscriptions drop column stripe_event_created_at;
