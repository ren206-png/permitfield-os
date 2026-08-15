-- Rollback for 20260806000005_permit_types_and_filings.sql
-- Drop order is FK-child-first: permit_form_fields and permit_type_filings
-- both reference permit_types, so both go before it. Neither child table
-- references the other, so their relative order doesn't matter. All three
-- indexes are dropped implicitly with their owning table.

drop policy if exists permit_form_fields_select on permit_form_fields;
drop policy if exists permit_type_filings_select on permit_type_filings;
drop policy if exists permit_types_select on permit_types;

drop table if exists permit_form_fields;
drop table if exists permit_type_filings;
drop table if exists permit_types;
