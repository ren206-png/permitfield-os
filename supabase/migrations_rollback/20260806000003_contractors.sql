-- Rollback for 20260806000003_contractors.sql
-- Dropping the table cascades its own policies (they are owned by the
-- table, not a separate dependency chain) and its index; the two select
-- calls out to is_org_member/is_org_owner (migration 0002) are left intact
-- since this migration does not own those functions.

drop policy if exists contractors_delete on contractors;
drop policy if exists contractors_update on contractors;
drop policy if exists contractors_insert on contractors;
drop policy if exists contractors_select on contractors;

drop table if exists contractors;
