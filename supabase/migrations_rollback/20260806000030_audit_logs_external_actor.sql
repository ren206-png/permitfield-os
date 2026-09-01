-- Rollback for 20260806000030_audit_logs_external_actor.sql
-- Drops the external-actor columns/constraints this migration added and
-- restores actor_user_id/actor_role to NOT NULL. Guarded: if any row has
-- already been written through the external-actor branch (external_actor_id
-- is not null, meaning actor_user_id/actor_role are null on that row),
-- restoring NOT NULL would orphan that row's actor attribution. Raise loud
-- instead, same discipline as this directory's enum-narrowing rollbacks
-- (e.g. 20260806000018's org_role guard).

do $$
declare
  v_external_count int;
begin
  select count(*) into v_external_count
  from audit_logs
  where external_actor_id is not null;
  if v_external_count <> 0 then
    raise exception 'cannot roll back 20260806000030: % audit_logs row(s) already use the external-actor branch (actor_user_id/actor_role null); this rollback cannot restore NOT NULL without orphaning them', v_external_count;
  end if;
end $$;

alter table audit_logs drop constraint if exists audit_logs_external_actor_label_requires_id;
alter table audit_logs drop constraint if exists audit_logs_actor_exactly_one_populated;

alter table audit_logs drop column if exists external_actor_label;
alter table audit_logs drop column if exists external_actor_id;

alter table audit_logs alter column actor_role set not null;
alter table audit_logs alter column actor_user_id set not null;
