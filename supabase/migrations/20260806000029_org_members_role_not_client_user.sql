-- Gate 2.0 SS B decision: Option 2 (separate Supabase project for client
-- auth) is the chosen model. Clients authenticate into that second project
-- and never hold a row in this project's org_members table at all -- there
-- is no "client member of an org" concept here, by design, not as a gap
-- pending future design work.
--
-- org_members.role is the org_role enum (20260806000002, extended
-- additively in 20260806000018), which already enforces its legal 10-value
-- set at the type level -- a blanket CHECK constraint mirroring that same
-- set would be redundant decoration, not a new guarantee (see the org_role
-- fixture-inventory investigation this migration follows from: every
-- distinct role value found across migrations, seed.sql, RLS/PL-pgSQL
-- functions, app code, and every supabase/tests/*.test.sql fixture already
-- falls inside the enum's 10 labels, and Postgres already refuses anything
-- outside that set). The one value that needed an explicit decision was
-- `client_user`: legal in the enum, present in lib/authz's Role type and
-- permission matrix, but never referenced by any RLS policy or PL/pgSQL
-- role-check anywhere in this schema, and documented in
-- GATE_2_0_FINDINGS.md SS E.2 as storable today with zero enforced
-- restriction behind it.
--
-- This is a single exclusion, not an allowlist: an allowlist would need
-- maintenance every time org_role gains a new label and would silently
-- block legitimate future roles. This states the actual invariant instead
-- -- org_members holds internal staff, and client_user is not internal
-- staff, permanently, because Option 2 puts clients in a different project
-- entirely rather than a future enforcement layer bolted onto this table.
--
-- CHECK rather than a trigger or RLS policy: it holds against every writer,
-- including service_role, which is what the future bridge layer between
-- the two projects will run as -- an RLS policy only restricts
-- `authenticated`, not service_role, and a trigger is more machinery than
-- a single-column invariant needs.

alter table org_members
  add constraint org_members_role_not_client_user
  check (role <> 'client_user');
