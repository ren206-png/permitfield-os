-- RLS policies only filter which rows a role can see once it already has
-- table-level access; they are not a substitute for GRANT. None of the prior
-- migrations issued GRANTs, so `authenticated`/`anon` had no SELECT/INSERT/
-- UPDATE/DELETE privileges at all (confirmed live via
-- information_schema.role_table_grants — every query failed with "permission
-- denied", not an RLS-filtered empty result). This migration is the single
-- place that grants table-level privileges; row-level filtering stays
-- entirely in each table's RLS policies.

-- Tenant-scoped tables: full CRUD grant to authenticated, RLS narrows to the
-- caller's org.
grant select, insert, update, delete on organizations to authenticated;
grant select, insert, update, delete on org_members to authenticated;
grant select, insert, update, delete on contractors to authenticated;
grant select, insert, update, delete on permit_applications to authenticated;
grant select, insert, delete on application_documents to authenticated;

-- anon: every RLS policy in this system is scoped `to authenticated`, so anon
-- has no policy granting it any row on any of these tables. Granting SELECT
-- here does not expose data -- it's what lets RLS's default-deny produce a
-- correct "0 rows" result instead of a table-level permission error, which
-- is the behavior supabase/tests/tenant_isolation.test.sql asserts against
-- (an anon caller should see an empty result set, not a Postgres error that
-- would leak table existence/structure via its error message).
grant select on permit_applications to anon;
grant select on jurisdictions to anon;

-- Append-only tables: insert allowed, update/delete are blocked by trigger
-- (forbid_update_delete / audit_findings_restrict_update), not by GRANT --
-- granting them is intentional so the trigger's error is what fires, not a
-- generic permission-denied that would leak which layer is enforcing it.
grant select, insert, update, delete on extractions to authenticated;
grant select, insert, update, delete on audits to authenticated;
grant select, insert, update, delete on audit_findings to authenticated;

-- Reference data: read-only for authenticated, writes are service-role only.
-- CORRECTION (added in 20260806000015, see its header comment for the full
-- story): service_role does NOT bypass GRANT checks -- only RLS. It needs its
-- own explicit grants just like every other role; those are issued in
-- 20260806000015_service_role_grants.sql, scoped to exactly what the
-- Inngest background functions touch, not granted here.
grant select on jurisdictions to authenticated;
grant select on authorities to authenticated;
grant select on permit_types to authenticated;
grant select on permit_type_filings to authenticated;
grant select on permit_form_fields to authenticated;
grant select on jurisdiction_code_chunks to authenticated;

-- ai_findings_rejected: deliberately no grants to authenticated or anon --
-- service-role-only by design (see migration 20260806000010). Nothing to do
-- here; this comment documents the omission is intentional, not an oversight.
