-- Rollback for 20260806000021_jurisdiction_sources.sql
-- Functions/grants before the policies that use them where relevant --
-- jurisdiction_sources_insert/_update both call is_platform_admin(), so that
-- function is dropped after those two policies, not before.

revoke execute on function jurisdiction_source_effective_status(jurisdiction_source_verification_status, timestamptz, integer) from service_role;
revoke execute on function jurisdiction_source_effective_status(jurisdiction_source_verification_status, timestamptz, integer) from authenticated;
drop function if exists jurisdiction_source_effective_status(jurisdiction_source_verification_status, timestamptz, integer);

revoke execute on function verify_jurisdiction_source(uuid, jurisdiction_source_verification_status, text, boolean) from authenticated;
drop function if exists verify_jurisdiction_source(uuid, jurisdiction_source_verification_status, text, boolean);

revoke select, insert, update on jurisdiction_sources from service_role;
revoke select, insert, update on jurisdiction_sources from authenticated;

drop policy if exists jurisdiction_sources_update on jurisdiction_sources;
drop policy if exists jurisdiction_sources_insert on jurisdiction_sources;
drop policy if exists jurisdiction_sources_select on jurisdiction_sources;

drop function if exists is_platform_admin();

drop table if exists jurisdiction_sources;

drop type if exists jurisdiction_source_verification_status;
drop type if exists jurisdiction_source_type;
