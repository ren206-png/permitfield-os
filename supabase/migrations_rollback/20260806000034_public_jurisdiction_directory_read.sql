-- Rollback for 20260806000034_public_jurisdiction_directory_read.sql
-- Drops the three anon SELECT policies this migration added and revokes the
-- two GRANTs it issued (authorities, permit_types). Does NOT revoke anon's
-- SELECT grant on jurisdictions -- that grant predates this migration
-- (20260806000011, for an unrelated reason per this migration's own header)
-- and this migration never issued it, so undoing only this migration must
-- leave it alone.
--
-- Must run only after 20260806000035's rollback has already restored the
-- state 20260806000035 tightened (that file's own rollback re-grants/
-- re-creates everything this file now removes) -- strict reverse-order
-- application, same discipline as every other pair of migrations in this
-- directory where a later one corrects an earlier one (e.g.
-- 20260806000011/20260806000015).

drop policy if exists permit_types_select_anon on permit_types;
drop policy if exists authorities_select_anon on authorities;
drop policy if exists jurisdictions_select_anon on jurisdictions;

revoke select on permit_types from anon;
revoke select on authorities from anon;
