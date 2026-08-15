# Migration rollbacks (Phase 1, gates 1.0-1.7)

One file per migration in `supabase/migrations/20260806000001` through
`20260806000028` -- the Phase 1 migration set per
`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md` §7 acceptance criteria
16 ("every migration has documented, tested rollback SQL") and 18 (client
portal explicitly excluded from Phase 1). Migrations `20260806000029`
onward are Gate 2.0 (client portal / lifecycle expansion) and deliberately
have **no** rollback file here -- that is a Gate 2.0 closeout deliverable,
not this one.

## Convention

Each file starts with `-- Rollback for <migration filename>` and a short
comment explaining what it undoes and why, then the DDL/data reversal
itself. Rollbacks are only safe applied in **strict reverse order**,
28 down to 1, each on top of the state the one after it left behind --
never in isolation against an arbitrary schema state. Several files
(e.g. `20260806000018`, `20260806000012`, `20260806000016`) widen an enum
type across their forward migration and can't be narrowed back with
`ALTER TYPE ... DROP VALUE` (Postgres has no such statement); those use
the standard rename-old-type / create-new-type / cast-column / drop-old-type
trick, guarded by a `DO` block that raises loud rather than silently
orphaning a row that already uses one of the values being removed.

## How this was tested

`scripts/test-migration-rollbacks.sh` runs `supabase db reset`, then walks
rollback 28 -> 1 in that same strict reverse order via `psql`, stopping
immediately on the first error, then runs `supabase db reset` again to
confirm the manual walk didn't leave the local Postgres container in a
state that breaks a subsequent clean forward apply.

Verified (Phase 1 closeout, 2026-08-15): all 28 rollbacks apply cleanly in
strict reverse order, and the fully-rolled-back state is genuinely empty
-- zero tables, zero enum types, zero functions, and zero storage buckets
left in `public`/`storage` (confirmed directly via `\dt`, `pg_type`,
`pg_proc`, and `storage.buckets` queries against the live container after
the walk), not just "no SQL errors." `supabase db reset` afterward
re-applies all 33 of today's migrations without issue.

### One caveat, not a defect: migrations 29+ are not rollback-neutral

This set was tested in isolation (`20260806000029` onward temporarily
moved out of `supabase/migrations/` for the test run, then restored) --
running the reverse walk against **today's full HEAD** (all 33 migrations
applied, 29-33 left in place) fails at rollback 18 specifically:
`20260806000029_org_members_role_not_client_user.sql` adds
`check (role <> 'client_user')` on `org_members.role`, and 18's rollback
renames the `org_role` enum type as part of narrowing it back to its
original two values -- the CHECK constraint's compiled expression is bound
to the old type's OID, and Postgres can't compare `org_role <>
org_role_old` once the column itself is recast to the new (renamed-back)
type.

This is expected, not a bug in 18's rollback: migration 29 is Gate 2.0,
outside Phase 1's scope, and nothing in Phase 1 promised to stay
rollback-compatible with migrations gate 2.0 hadn't been written yet when
this rollback set was authored. A genuine historical rollback from
today's tip back past migration 18 would first need rollback SQL for
29-33 (their own gate's closeout responsibility) to run ahead of 18's,
exactly the same reverse-order discipline this whole directory already
follows -- there is nothing to fix here, only to note for whoever writes
that rollback set later.

## Re-running this test

```bash
supabase db reset   # or let the script do it
bash scripts/test-migration-rollbacks.sh
```

Use `--stop-at N` to stop the walk after rolling back migration N
(inclusive) instead of going all the way to 1 -- useful while iterating on
one file without re-running the whole chain. Use `--skip-initial-reset` if
the stack is already at a known-good, fully-forward-applied state.
