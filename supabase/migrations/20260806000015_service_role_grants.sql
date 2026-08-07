-- Adversarial self-check (Phase 3) caught a real, pre-existing bug: every
-- Inngest background function (permitExtract since Phase 2, permitAudit as of
-- this phase) runs against Supabase via lib/supabase/service-client.ts's
-- `service_role` client, but 20260806000011_grants.sql's own header comment
-- claimed "service_role bypasses RLS and GRANT checks entirely" -- that's
-- wrong. `service_role` has the Postgres `BYPASSRLS` attribute (confirmed via
-- pg_roles), which bypasses ROW-level security policies only. It is NOT a
-- superuser and holds no table-level privileges of its own; GRANT is an
-- entirely separate permission layer that BYPASSRLS does not touch. Verified
-- live: with only the grants from migration 20260806000011 applied,
-- `service_role` had zero SELECT/INSERT/UPDATE/DELETE privileges on any
-- `public` schema table (information_schema.role_table_grants showed only
-- TRIGGER/REFERENCES/TRUNCATE, granted by Postgres to every role by default
-- on some installs) -- meaning every background job would have failed with
-- "permission denied for table ..." on its very first query, in every
-- environment this had ever been deployed to. This was never caught earlier
-- because supabase/tests/tenant_isolation.test.sql only ever exercised the
-- `authenticated`/`anon` roles, and the eval harness (eval/run.ts) never
-- touches a live database at all.
--
-- Grants below are scoped to exactly the tables and operations
-- lib/inngest/functions/extract.ts and lib/inngest/functions/audit.ts
-- actually perform against the service-role client (grep-verified), per this
-- repo's explicit-grants-only convention (20260806000011_grants.sql) --
-- not a blanket `grant all on all tables to service_role`. SELECT is
-- included alongside INSERT wherever code chains `.select()` after
-- `.insert()`, because Postgres requires SELECT privilege on any column
-- read back via RETURNING, which is what `.select()` compiles down to.

grant select, update on permit_applications to service_role;
grant select, update on application_documents to service_role;
grant select, insert on extractions to service_role;
grant select on permit_types to service_role;
grant select on jurisdictions to service_role;
-- jurisdiction_code_chunks: not queried directly via .from() anywhere in
-- lib/ai/retrieve-code-chunks.ts (it goes through the
-- search_jurisdiction_code_chunks RPC instead), but that RPC is declared
-- `language sql` without `security definer` (20260806000014's own header
-- explains why: it's meant to run under the CALLER's privileges so its
-- explicit license_status filter is layered on top of, not a replacement
-- for, RLS) -- which means it executes with the calling role's own table
-- privileges, not the function owner's. Caught live: calling the RPC as
-- service_role failed with "permission denied for table
-- jurisdiction_code_chunks" until this grant was added.
grant select on jurisdiction_code_chunks to service_role;
grant select, insert on audits to service_role;
grant insert on audit_findings to service_role;
grant insert on ai_findings_rejected to service_role;
