-- Rollback for 20260806000029_org_members_role_not_client_user.sql
-- Single CHECK constraint added by the forward migration; drop it.

alter table org_members drop constraint if exists org_members_role_not_client_user;
