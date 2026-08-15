#!/usr/bin/env bash
#
# Gate 2.0 Task 2 (CI wiring for the second Supabase project): runs every
# supabase-client-portal/supabase/tests/*.test.sql file against a running
# local Postgres instance for that project, and reports pass/fail per file.
#
# This is the client-portal-project counterpart to scripts/run-sql-tests.sh
# -- same structure, same fail-loud-on-empty-glob guard, same per-file
# PASS/FAIL reporting -- pointed at the second project via `supabase
# --workdir supabase-client-portal` instead of the default (repo-root)
# project. See supabase-client-portal/supabase/config.toml's header for why
# this is a second, separate project rather than a schema in project 1.
#
# This script deliberately does NOT call `supabase start`/`supabase stop`
# itself, for the same reason run-sql-tests.sh doesn't: stack lifecycle is
# a separate, explicit caller step, so running this twice against an
# already-seeded stack is safe and fast.
#
# HOW TO RUN:
#   1. supabase --workdir supabase-client-portal start
#   2. supabase --workdir supabase-client-portal db reset
#   3. npm run test:sql:client-portal
#      (or: bash scripts/run-client-portal-sql-tests.sh)
#
# A clean run prints each file's NOTICEs followed by "PASS: <file>" for
# every file, and exits 0. Any file containing an uncaught RAISE EXCEPTION
# makes psql exit non-zero (via -v ON_ERROR_STOP=1) -- this script catches
# that per-file, prints "FAIL: <file>", continues to the remaining files,
# and exits non-zero overall if anything failed.
#
# Fails loud (non-zero exit, before running anything) if the test glob is
# empty -- this is the exact gap that let PR #6's CI report green while
# never executing client_portal_token_lifecycle.test.sql at all: a job
# that silently has nothing to run must not look like a job that ran
# everything and passed.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WORKDIR="supabase-client-portal"

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not installed or not on PATH. See PHASE_0_FINDINGS.md SS1." >&2
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: supabase CLI is not installed or not on PATH." >&2
  exit 1
fi

DB_URL="$(supabase --workdir "$WORKDIR" status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"

if [ -z "$DB_URL" ]; then
  echo "error: could not determine DB_URL for $WORKDIR. Is its local Supabase stack running?" >&2
  echo "       Run 'supabase --workdir $WORKDIR start' first." >&2
  exit 1
fi

shopt -s nullglob
TEST_FILES=("$WORKDIR"/supabase/tests/*.test.sql)
shopt -u nullglob

if [ ${#TEST_FILES[@]} -eq 0 ]; then
  echo "error: no *.test.sql files found under $WORKDIR/supabase/tests/." >&2
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
