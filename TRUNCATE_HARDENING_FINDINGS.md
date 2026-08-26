# TRUNCATE_HARDENING_FINDINGS.md — closing the TRUNCATE gap on append-only tables

Follow-up to `SERVICE_ROLE_GRANTS_FINDINGS.md` (2026-08-26), which established
that `service_role` holds the full privilege set (`DELETE, INSERT,
REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`) on every public-schema table
by Supabase platform default, and left "whether to pursue least-privilege
hardening" as an explicitly open, unscoped decision (§6 of that file). This
document scopes and closes one slice of that decision rather than the whole
thing.

## 1. Why this slice, not the whole 34-table project

`SERVICE_ROLE_GRANTS_FINDINGS.md` §6 correctly declined to turn "narrow
`service_role` to least-privilege everywhere" into a reactive fix — that
needs a full audit of every service-role call site across
`lib/inngest/functions/` and `lib/bridge/client-portal.ts` and is a real
project of its own.

This slice is different in kind, not just smaller: it isn't generic
hardening, it's a live gap in a guarantee this codebase already claims to
provide. Seven tables in this schema exist specifically to be append-only —
`extractions`, `audits`, `audit_findings`, `generated_documents`,
`audit_logs`, `application_status_history`, and `document_revisions` — and
each one enforces that with a dedicated trigger:

| Table | Migration | Trigger(s) |
|---|---|---|
| `extractions` | `20260806000007` | `forbid_update_delete()` |
| `audits` | `20260806000009` | `forbid_update_delete()` |
| `audit_findings` | `20260806000009` | `forbid_delete()`, `audit_findings_restrict_update()` |
| `generated_documents` | `20260806000017` | `forbid_update_delete()` |
| `audit_logs` | `20260806000018` | `forbid_update_delete()` |
| `application_status_history` | `20260806000022` | `forbid_update_delete()` |
| `document_revisions` | `20260806000024` | `forbid_update_delete()` |

All of these are **row-level** triggers (`before update or delete ... for
each row`). Postgres row-level triggers never fire on `TRUNCATE` — only a
statement-level `before truncate` trigger or an event trigger would catch
it, and grepping every file in `supabase/migrations/` for `truncate` returns
zero results. Nothing in this schema has ever guarded against it.

Combined with the platform default from `SERVICE_ROLE_GRANTS_FINDINGS.md`,
this meant `service_role` — the credential every background job
(`lib/inngest/functions/*`) and the client-portal bridge
(`lib/bridge/client-portal.ts`) runs as — could run, for example,
`truncate audit_logs;` and instantly, silently erase this platform's entire
audit trail, with every one of the protections in the table above unable to
stop it. For a platform that submits permits to government jurisdictions on
a client's behalf, an audit trail that can be wiped in a single statement is
a concrete liability (own incident forensics, and any future compliance or
dispute conversation with a client or a jurisdiction), not a theoretical
one — which is why this got pulled forward instead of folded into the
deferred 34-table project.

## 2. What was verified before writing the fix

- Grepped every `create trigger ... forbid_update_delete|forbid_delete`
  attachment across `supabase/migrations/` to get the exact table list
  above (not just files that mention the pattern in comments — e.g.
  `20260806000019` and `20260806000027` reference "append-only" in prose but
  attach no trigger; excluded).
- Confirmed via grep that no table outside this set of seven holds a foreign
  key into any of them, except `audit_findings.audit_id → audits(id)`,
  which is inside the set. This matters for the test file (see below): a
  bare `truncate audits` fails on an unlisted incoming foreign key
  regardless of privilege, independent of the fix this migration makes.
- Confirmed via grep of `supabase/migrations/*.sql` that this repo's own
  migrations only ever grant `service_role` `select`/`insert` on these seven
  tables (never `update`, `delete`, or `truncate`) — the platform default is
  the sole source of the excess privilege being revoked here, not a mistake
  in this repo's own grant statements.

## 3. The fix

`20260806000033_revoke_service_role_truncate_append_only.sql` revokes
`TRUNCATE` from `service_role` on exactly the seven tables above. `UPDATE`
and `DELETE` are deliberately left untouched: the row-level triggers already
reject both for `service_role`, identically to every other role (proven live
in `supabase/tests/service_role_truncate_append_only.test.sql`), so revoking
them too would be redundant, not additional defense-in-depth. `TRUNCATE` is
the only privilege in this set with no other enforcement layer behind it.

`supabase/tests/service_role_truncate_append_only.test.sql` proves it
live, control-then-assert, inverted shape (this is a capability being
*removed*, mirroring how `bridge_read_grants.test.sql` handles a capability
being *added*): temporarily re-grant `TRUNCATE`, confirm `service_role`
really can truncate all seven tables (control — proves the gap was real);
revoke again, confirm the identical `TRUNCATE` now fails with
`insufficient_privilege` (assert — proves the fix holds). `TRUNCATE` is
transactional in Postgres, so the whole file's `begin; ... rollback;`
wrapper fully undoes the control step's actual truncation of live seed data,
same as every other file in `supabase/tests/`.

## 4. What this does NOT cover

- **Not the other 27 public-schema tables.** This is a targeted fix for the
  seven tables whose entire design premise (append-only, tamper-evident) the
  TRUNCATE gap directly undermined. The broader question — should
  `service_role` be narrowed to least-privilege everywhere — remains the
  open, separately-scoped decision from `SERVICE_ROLE_GRANTS_FINDINGS.md`
  §6. Not started here.
- **Not `DELETE`/`UPDATE` on these seven tables**, or `INSERT`/`DELETE` on
  any other table — out of scope per §3 above.
- **Not a claim that the service-role key has leaked or been misused.**
  Nothing here is evidence of an incident; this closes a gap discovered
  through code review, not through an observed exploit.
- **Not a change to `application_status_history`'s or any other table's
  RLS policies** — `service_role` has `BYPASSRLS`, so RLS was never the
  relevant layer for this role on these tables (same reasoning as
  `SERVICE_ROLE_GRANTS_FINDINGS.md` §3).
