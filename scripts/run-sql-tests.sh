#!/usr/bin/env bash
#
# Lifecycle & Compliance Expansion, Phase 1.1 gap follow-up (self-check
# item 10): runs every supabase/tests/*.test.sql file against a running
# local Supabase Postgres instance and reports pass/fail per file.
#
# This script deliberately does NOT call `supabase start`/`supabase stop`
# itself. Stack lifecycle (start, `db reset` to re-apply migrations +
# seed.sql, stop) stays a separate, explicit step the caller runs first --
# the same way a real CI job would have a dedicated "start services" step
# before a dedicated "run tests" step, rather than one script silently
# doing both. This also means running this script twice in a row against
# an already-seeded stack is safe and fast: no unnecessary reset.
#
# Each *.test.sql file wraps its own assertions in `begin; ... rollback;`
# (see any file in supabase/tests/ for the pattern), so running them here
# leaves no residue in the database either way.
#
# HOW TO RUN:
#   1. supabase start        (starts local Postgres + applies migrations)
#   2. supabase db reset     (re-applies migrations + seed.sql fixtures)
#   3. npm run test:sql      (or: bash scripts/run-sql-tests.sh)
#
# A clean run prints each file's NOTICEs followed by "PASS: <file>" for
# every file, and exits 0. Any file containing an uncaught RAISE EXCEPTION
# makes psql exit non-zero (via -v ON_ERROR_STOP=1) -- this script catches
# that per-file, prints "FAIL: <file>", continues to the remaining files
# (so one failure doesn't hide others in the same run), and exits non-zero
# overall if anything failed.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not installed or not on PATH. See PHASE_0_FINDINGS.md SS1." >&2
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: supabase CLI is not installed or not on PATH." >&2
  exit 1
fi

DB_URL="$(supabase status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"

if [ -z "$DB_URL" ]; then
  echo "error: could not determine DB_URL. Is the local Supabase stack running?" >&2
  echo "       Run 'supabase start' first." >&2
  exit 1
fi

shopt -s nullglob
TEST_FILES=(supabase/tests/*.test.sql)
shopt -u nullglob

if [ ${#TEST_FILES[@]} -eq 0 ]; then
  echo "error: no *.test.sql files found under supabase/tests/." >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
FAILED_FILES=()

for file in "${TEST_FILES[@]}"; do
  echo "----- running $file -----"
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$file"; then
    echo "PASS: $file"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $file"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_FILES+=("$file")
  fi
  echo
done

echo "===== summary: $PASS_COUNT passed, $FAIL_COUNT failed (of ${#TEST_FILES[@]} files) ====="

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "Failed files:" >&2
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi

exit 0
