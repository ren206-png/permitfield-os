-- Rollback for 20260806000004_jurisdictions_and_authorities.sql
-- authorities is dropped before jurisdictions (authorities.jurisdiction_id
-- FK references jurisdictions). The jurisdiction_id index on authorities is
-- dropped implicitly with the table. Enum types are dropped last, after
-- every column that used them is gone.

drop policy if exists authorities_select on authorities;
drop policy if exists jurisdictions_select on jurisdictions;

drop table if exists authorities;
drop table if exists jurisdictions;

drop type if exists filing_mechanism;
drop type if exists authority_level;
drop type if exists coverage_level;
