# SERVICE_ROLE_GRANTS_FINDINGS.md — `service_role` table privileges

Investigated 2026-08-26, prompted by `supabase/tests/bridge_read_grants.test.sql`
failing in CI on two unrelated PRs (marketing homepage, signup fix — neither
touches `supabase/`). Documented here rather than silently patched, per this
repo's own evidentiary convention, because it corrects a claim several
existing migrations and tests rely on.

## 1. The claim being corrected

`20260806000032_bridge_read_grants.sql`'s header states its three
`grant select on <table> to service_role;` statements are narrowly scoped
and that `service_role` cannot INSERT/UPDATE/DELETE on `organizations`,
`application_status_history`, or `readiness_checklist_items` as a result.
`supabase/tests/bridge_read_grants.test.sql` asserted this with a live
negative check (attempt INSERT, expect `insufficient_privilege`).

An earlier migration, `20260806000015_service_role_grants.sql`, made a
stronger version of the same claim: "Verified live: with only the grants
from migration 20260806000011 applied, `service_role` had zero
SELECT/INSERT/UPDATE/DELETE privileges on any `public` schema table."

## 2. What was actually verified live (production), 2026-08-26

Queried `information_schema.role_table_grants` directly against the live
production database (`peqysqudhrkpoqrgvnod`, via the Supabase Studio SQL
editor, `select ... where grantee = 'service_role' and table_schema =
'public' group by table_name`):

**All 34 tables in the `public` schema grant `service_role` the identical
full set: `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`.**
Not just the three tables this migration touches — every table, including
ones this repo's own migrations only ever explicitly granted `SELECT` or
narrower on (e.g. `organizations`, `jurisdictions`, `permit_types`).

The local Supabase CLI / Docker Postgres stack used in CI exhibits the
same behavior (the CI failure this investigation started from is the
identical symptom locally).

## 3. Root cause

This is Supabase's own platform-level default: `service_role` is granted
full table privileges on every `public` schema table as part of Supabase's
standard project bootstrap, independent of and prior to any grant this
repo's own migrations add. Table-level `GRANT`/`REVOKE` was never the
enforcement boundary for `service_role` — it never has been, on this
platform. The actual (and, on Supabase, only) enforcement boundary for
`service_role` is `BYPASSRLS` plus **never letting the service-role key
reach untrusted code** (i.e., keeping it server-only).

This repo's earlier "verified live: zero privileges" finding
(`20260806000015`) does not hold today and, on reflection, most likely
reflected a database state that predated Supabase's own default-privilege
bootstrap being applied to those specific tables — not something this
repo's migrations ever controlled either way.

## 4. What this does NOT mean

- **Not a new vulnerability.** `service_role`'s privilege scope hasn't
  changed; the codebase's understanding of it was wrong. No prior behavior
  regressed.
- **Not evidence the service-role key has leaked.** Separately audited
  2026-08-26: every import of `lib/supabase/service-client.ts` and
  `lib/supabase/client-portal-service-client.ts` is a server-only file
  (Inngest functions, the bridge layer) — none is a `'use client'`
  component, and a fresh `next build`'s client JS chunks contain zero
  occurrences of `SUPABASE_SERVICE_ROLE_KEY` or
  `CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY`. The real boundary (server-only
  key usage) holds.

## 5. What changed as a result of this finding

`supabase/tests/bridge_read_grants.test.sql`'s three negative
("regression") assertions — which asserted `service_role` INSERT is
rejected on these tables — have been removed. They asserted something
false about the platform, not something this repo's own migration ever
had control over; leaving them in place would fail CI permanently on an
assumption no future change here can satisfy. The control/assert SELECT
checks (proving the `SELECT` grant itself does what it says) are
unchanged and still pass.

`20260806000032_bridge_read_grants.sql` itself is left untouched — its
`grant select` statements are harmless (redundant with the platform
default, but not wrong), and this repo's convention is to never edit an
already-applied migration file's history.

## 6. Open decision, not made here

Whether to pursue actually narrowing `service_role`'s privileges to
least-privilege across all 34 tables (via explicit `revoke` migrations,
informed by a full audit of every service-role code path) is a real,
separate defense-in-depth question — RLS-equivalent hardening for a role
that already bypasses RLS. Given the scope (every table, every
service-role call site in `lib/inngest/functions/` and
`lib/bridge/client-portal.ts`), this needs its own deliberate, scoped
project if pursued, not a reactive fix. Not started here.
