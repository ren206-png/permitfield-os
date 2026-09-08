# Migration rollbacks

One file per migration in `supabase/migrations/`, `20260806000001` through
`20260806000041` (every migration in the repo as of this update). The first
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
own header admits it had never been executed before). `20260806000040` is
the billing build (`BILLING_PROPOSAL.md`) -- the `org_subscriptions` table
and the `create_organization_with_owner()` extension that inserts a trial
row alongside every new org; its rollback restores that function to its
pre-billing body before dropping the table, see that rollback file's own
header for why order matters here specifically. Any migration added after
`20260806000040` still needs its own rollback file here, following the
same convention, before it can be considered closed out the way this
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

Extended to 40 (billing build, `BILLING_PROPOSAL.md`): verified via
`--start-at 40 --stop-at 40` in isolation, then the full 40 -> 1 walk with
the same empty-end-state checks as above, then `npm run test:sql` (all 18
files, including the new `org_subscriptions.test.sql`, pass). That new test
file's own first run against a live database surfaced two real bugs, both
fixed directly in the test file (not the migration -- the schema/grants it
exercises were correct on first try):
- `create_organization_with_owner()` inserts into `org_members` with
  `user_id = auth.uid()`, which carries a real FK to `auth.users` -- the
  test's two synthetic user ids had no fixture row there yet (unlike
  seed.sql's Org A/Org B owners), so the very first RPC call failed
  `org_members_user_id_fkey`. Fixed by inserting throwaway `auth.users`
  rows for both synthetic users first, same pattern
  `lifecycle_intake.test.sql` already uses for its own synthetic org-C
  member.
- The test's own `create temporary table _test_org_ids` (used to stash the
  RPC's `gen_random_uuid()`'d return values across `set local role`
  boundaries, since a real placeholder id isn't knowable ahead of time) is
  owned by `postgres`, but every `do` block that reads/writes it runs as
  `authenticated` or `service_role` -- neither has an implicit grant on a
  table it doesn't own, so an explicit `grant select, insert on
  _test_org_ids to authenticated, service_role` was needed right after
  creating it. No other test file in this suite uses a temp table this way
  yet, so there was no existing precedent for this grant.

Extended to 41 (post-billing health-check audit): a pure three-index
addition (`org_members.user_id`, `contractors.org_id`,
`permit_types.jurisdiction_id` -- FK columns queried/joined on frequently
but never indexed in their own migration, `org_members.user_id` backing
`requireOrgContext()`'s per-request lookup on every `(app)` page render).
Verified via `--start-at 41 --stop-at 41` in isolation (three `DROP INDEX`
statements, clean forward `db reset` after), then the full 41 -> 1 walk,
then `npm run test:sql` (all 18 files pass unchanged -- indexes alone don't
change any query's result set, only its plan, so no test file needed
touching).

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
