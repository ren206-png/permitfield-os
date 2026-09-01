# Migration rollbacks

One file per migration in `supabase/migrations/`, `20260806000001` through
`20260806000039` (every migration in the repo as of this update). The first
28 are the Phase 1 migration set per
`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md` §7 acceptance criteria
16 ("every migration has documented, tested rollback SQL") and 18 (client
portal explicitly excluded from Phase 1). `20260806000029` through
`20260806000038` are Gate 2.0 (client portal / lifecycle expansion) and
Gate AI-1 (adapter, router, retrieval schema) -- rollback SQL for that range
was added later, closing the gap this file's own "one caveat" section
below used to describe as future work (see `GATE_2_0_FINDINGS.md` §H.7).
`20260806000039` is a small Gate AI-1 follow-up fixing a service_role grant
gap on `jurisdiction_code_chunks` found by actually running
`supabase/tests/jurisdiction_code_chunks_dimensions.test.sql` (that test's
own header admits it had never been executed before). Any migration added
after `20260806000039` still needs its own rollback file here, following
the same convention, before it can be considered closed out the way this
directory's own acceptance criterion expects.

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

`scripts/test-migration-rollbacks.sh` runs `supabase db reset` (applying
every migration currently in `supabase/migrations/`), then walks the
rollback chain in strict reverse order via `psql` -- from the
highest-numbered migration present down to 1 by default -- stopping
immediately on the first error, then runs `supabase db reset` again to
confirm the manual walk didn't leave the local Postgres container in a
state that breaks a subsequent clean forward apply.

Verified (Phase 1 closeout, 2026-08-15): all 28 Phase 1 rollbacks apply
cleanly in strict reverse order, and the fully-rolled-back state is
genuinely empty -- zero tables, zero enum types, zero functions, and zero
storage buckets left in `public`/`storage`, not just "no SQL errors."

Re-verified with the full chain (Gate 2.0 / Gate AI-1 closeout,
2026-09-01): all 38 rollbacks -- the original 28 plus the 10 added for
migrations 29-38 -- apply cleanly in strict reverse order from today's
full `supabase/migrations/` HEAD, confirmed directly via `\dt`, `pg_type`,
`\df`, and `storage.buckets` queries against the live container after the
walk (zero tables/types/functions/buckets left), and `supabase db reset`
re-applies all 38 migrations without issue afterward. The rollback-18
enum-narrowing conflict the "one caveat" section below used to describe
no longer reproduces, because rollback 29 (which drops the CHECK
constraint that conflicted with 18's `org_role` type rename) now runs
ahead of 18 in the same walk, exactly as that section predicted it would
once this range's rollback SQL existed.

Extended the same day to 39: running the full test suite
(`npm run test:sql`) after the above closeout surfaced a real gap --
`jurisdiction_code_chunks_dimensions.test.sql` failed with "permission
denied for table jurisdiction_code_chunks" because `service_role` had
only ever been granted SELECT on that table (20260806000015), never
INSERT, and that test's own fixture setup (seeding rows as `service_role`,
the same role a real ingestion job would use) had never actually been run
before. `20260806000039` grants the missing privilege; its rollback
revokes it. Verified via `--start-at 39 --stop-at 39` in isolation, then
the full 39 -> 1 walk with the same empty-end-state checks as above, then
`npm run test:sql` (all 17 files, including the previously-failing one,
pass).

Two of the new files are worth calling out specifically, since they
depend on the *data* in the database at rollback time, not just its
schema:

- **`20260806000030`'s rollback** (`audit_logs_external_actor`) guards
  with a `raise exception` if any `audit_logs` row has already been
  written through the external-actor branch this migration added --
  restoring `NOT NULL` on `actor_user_id`/`actor_role` would otherwise
  orphan that row's attribution. No such row exists in any environment
  tested here (the client-portal bridge layer has zero live callers, per
  `GATE_3_0_FINDINGS.md` §C.1), so this guard has not yet been exercised
  against a real violation -- only confirmed to not false-positive against
  today's empty case.
- **`20260806000034`/`20260806000035`** must roll back together, in that
  order (35 then 34) -- 35 corrects 34 in the forward direction (tightens
  an `anon`-readable base-table grant down to two curated views), so 35's
  rollback restores the state 34 left behind before 34's own rollback runs
  against it. Verified as part of the full 38 -> 1 walk above, not in
  isolation.

## Re-running this test

```bash
supabase db reset   # or let the script do it
bash scripts/test-migration-rollbacks.sh
```

Use `--stop-at N` to stop the walk after rolling back migration N
(inclusive) instead of going all the way to 1 -- useful while iterating on
one file without re-running the whole chain. Use `--start-at N` to start
the walk below the highest migration present (e.g. `--start-at 38
--stop-at 29` to test only the Gate 2.0/AI-1 range in isolation). Use
`--skip-initial-reset` if the stack is already at a known-good,
fully-forward-applied state.
