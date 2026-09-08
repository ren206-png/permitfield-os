-- Rollback for 20260806000041_missing_fk_indexes.sql
-- Drops the three indexes this migration added. Pure index removal --
-- no data loss, no dependent objects (nothing else in this migration set
-- references these index names directly).

drop index org_members_user_id_idx;
drop index contractors_org_id_idx;
drop index permit_types_jurisdiction_id_idx;
