#!/usr/bin/env bash
#
# Tests supabase/migrations_rollback/*.sql. Originally Phase 1 closeout
# (migrations 20260806000001-28, gates 1.0-1.7 -- see
# docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md SS7 items 16/18); extended
# to 20260806000038 as the Gate 2.0/Gate AI-1 closeout deliverable that
# supabase/migrations_rollback/README.md's own §"one caveat" section named
# as future work when it was still deferred. Every migration through 38 now
# has a rollback file, so the walk below runs the full chain, top to bottom.
#
# Runs the FULL current migration set forward (supabase db reset --
# whatever's in supabase/migrations/ today), then walks the rollback chain
# in strict reverse order (default: TOP -> 1, TOP resolved dynamically from
# the highest-numbered file actually present in supabase/migrations/)
# against that live state, cumulatively (each rollback runs on top of
# whatever the previous one left behind), stopping immediately on the first
# error so it's obvious which migration's rollback needs fixing. On full
# success, runs `supabase db reset` one more time to confirm the manual
# rollback walk didn't leave the local Postgres container in a state that
# breaks a subsequent clean forward apply.
#
# Usage: bash scripts/test-migration-rollbacks.sh [--stop-at N] [--start-at N]
#   --stop-at N   stop after rolling back migration N (inclusive), instead
#                 of walking all the way down to 1. Useful for iterating on
#                 one migration's rollback file without re-running the
#                 whole chain every time.
#   --start-at N  start the walk at migration N instead of the highest
#                 migration present in supabase/migrations/. Useful for
#                 testing a sub-range (e.g. --start-at 38 --stop-at 29 to
#                 test only the Gate 2.0/AI-1 rollback files added after
#                 Phase 1 closeout).

set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STOP_AT=1
START_AT=""
SKIP_RESET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --stop-at) STOP_AT="$2"; shift 2 ;;
    --start-at) START_AT="$2"; shift 2 ;;
    --skip-initial-reset) SKIP_RESET=1; shift ;;
    *) shift ;;
  esac
done

if [ -z "$START_AT" ]; then
  # Highest-numbered migration actually present in supabase/migrations/,
  # not a hardcoded constant -- so this script doesn't silently go stale
  # (as it did between migrations 28 and 38) the next time a migration is
  # added and its rollback file lands alongside it.
  START_AT="$(ls supabase/migrations/202608060000*.sql 2>/dev/null \
    | sed -E 's#.*/202608060000([0-9]+)_.*#\1#' \
    | sort -n | tail -1 | sed 's/^0*//')"
  if [ -z "$START_AT" ]; then
    echo "error: could not determine highest migration number from supabase/migrations/." >&2
    exit 1
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not on PATH." >&2
  exit 1
fi

if [ "$SKIP_RESET" = "1" ]; then
  echo "===== skipping initial db reset (--skip-initial-reset) ====="
else
  echo "===== supabase db reset (forward: applies everything in supabase/migrations/) ====="
  supabase db reset || { echo "FAIL: initial db reset"; exit 1; }
fi

DB_URL="$(supabase status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
if [ -z "$DB_URL" ]; then
  echo "error: could not determine DB_URL." >&2
  exit 1
fi

for n in $(seq -f "%02g" "$START_AT" -1 "$STOP_AT"); do
  file="supabase/migrations_rollback/202608060000${n}"*.sql
  file="$(ls $file 2>/dev/null)"
  if [ -z "$file" ]; then
    echo "FAIL: no rollback file matching 202608060000${n}*.sql"
    exit 1
  fi
  echo "===== rolling back migration ${n}: $file ====="
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$file"; then
    echo "OK: rollback ${n} applied cleanly"
  else
    echo "FAIL: rollback ${n} ($file) errored -- fix and re-run"
    exit 1
  fi
  echo
done

echo "===== all rollbacks from ${START_AT} down to ${STOP_AT} applied cleanly. Confirming forward db reset still works ====="
supabase db reset && echo "PASS: db reset succeeded after the rollback walk" || { echo "FAIL: db reset broke after the rollback walk"; exit 1; }
