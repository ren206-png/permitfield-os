#!/usr/bin/env bash
#
# Gate 4 (Quotes & Payments), Phase A -- real concurrency proof for
# issue_invoice()'s per-org sequential numbering
# (supabase/migrations/20260806000047_invoices.sql).
#
# A single supabase/tests/*.test.sql file (run.sql, one psql -f process, one
# connection) cannot exercise genuine lock contention between two OVERLAPPING
# transactions -- everything in it runs strictly sequentially on one
# connection. This script instead opens two REAL, separate psql connections,
# each in its own explicit transaction, and forces them to overlap in time:
#
#   Session A: BEGIN; issue_invoice(invoice A); pg_sleep(4); COMMIT;
#   Session B: (started ~1s after A)  BEGIN; issue_invoice(invoice B); COMMIT;
#
# issue_invoice()'s own `UPDATE invoice_number_counters SET next_number =
# next_number + 1 ... WHERE org_id = ...` statement takes a row-level lock on
# that org's single counter row. Session A's UPDATE runs first and holds that
# lock until A's COMMIT (after its 4-second sleep). Session B's UPDATE,
# inside its own issue_invoice() call, targets the SAME row and therefore
# BLOCKS -- Postgres makes it wait, not proceed with a stale value -- until A
# releases the lock. If B's issue_invoice() call returns and prints its
# result BEFORE A's sleep has elapsed, the lock did not actually serialize
# the two calls and this script's core claim (which migration
# 20260806000047's header comment makes) is false; this script measures
# exactly that and fails loudly if so.
#
# Expected, correct outcome: invoice A gets number 1, invoice B gets number
# 2 (never both 1, never a gap, never B finishing before A's sleep ends).
#
# HOW TO RUN:
#   1. supabase start
#   2. supabase db reset
#   3. bash scripts/test-invoice-number-concurrency.sh
#
# Idempotent: uses fixed, dedicated fixture ids distinct from seed.sql's own
# fixtures, with ON CONFLICT DO NOTHING / a fresh pair of draft invoices
# created on every run, so re-running this script is safe.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not installed or not on PATH." >&2
  exit 1
fi
if ! command -v supabase >/dev/null 2>&1; then
  echo "error: supabase CLI is not installed or not on PATH." >&2
  exit 1
fi

DB_URL="$(supabase status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
if [ -z "$DB_URL" ]; then
  echo "error: could not determine DB_URL. Run 'supabase start' first." >&2
  exit 1
fi

ORG_ID="7c000000-0000-0000-0000-00000000000a"
USER_ID="7c000000-0000-0000-0000-00000000001a"
CLIENT_ID="7c000000-0000-0000-0000-00000000002a"
INVOICE_A="$(python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || cat /proc/sys/kernel/random/uuid)"
INVOICE_B="$(python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || cat /proc/sys/kernel/random/uuid)"

echo "Setting up fixtures (org=$ORG_ID, invoice A=$INVOICE_A, invoice B=$INVOICE_B)..."

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into organizations (id, name) values ('$ORG_ID', 'Concurrency Test Org') on conflict (id) do nothing;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '$USER_ID', 'authenticated', 'authenticated',
        'concurrency-test-owner@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values ('$ORG_ID', '$USER_ID', 'owner') on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values ('$CLIENT_ID', '$ORG_ID', 'Concurrency Test Client') on conflict (id) do nothing;

insert into invoices (id, org_id, client_id) values ('$INVOICE_A', '$ORG_ID', '$CLIENT_ID');
insert into invoices (id, org_id, client_id) values ('$INVOICE_B', '$ORG_ID', '$CLIENT_ID');

-- Reset this org's counter to a known starting point (1) so the assertion
-- below (A=1, B=2) is deterministic across repeated runs.
delete from invoice_number_counters where org_id = '$ORG_ID';
SQL

CLAIMS="{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}"

OUT_A="$(mktemp)"
OUT_B="$(mktemp)"
trap 'rm -f "$OUT_A" "$OUT_B"' EXIT

echo "Starting session A (will hold the counter-row lock for 4s after issuing)..."
(
  T0=$(date +%s.%N)
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '$CLAIMS';
select invoice_number from issue_invoice('$INVOICE_A', '[]'::jsonb, 1000, 0, 0, 1000);
select pg_sleep(4);
commit;
SQL
  T1=$(date +%s.%N)
  echo "session_a_start=$T0" > "$OUT_A"
  echo "session_a_end=$T1" >> "$OUT_A"
) &
PID_A=$!

sleep 1

echo "Starting session B (its issue_invoice() call should now block on A's lock)..."
(
  T0=$(date +%s.%N)
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '$CLAIMS';
select invoice_number from issue_invoice('$INVOICE_B', '[]'::jsonb, 2000, 0, 0, 2000);
commit;
SQL
  T1=$(date +%s.%N)
  echo "session_b_start=$T0" > "$OUT_B"
  echo "session_b_end=$T1" >> "$OUT_B"
) &
PID_B=$!

wait "$PID_A"
wait "$PID_B"

# shellcheck disable=SC1090
source "$OUT_A"
# shellcheck disable=SC1090
source "$OUT_B"

echo
echo "Timing: session A ran ${session_a_start} -> ${session_a_end} (held lock ~4s)."
echo "        session B ran ${session_b_start} -> ${session_b_end}."

NUM_A="$(psql "$DB_URL" -tA -c "select invoice_number from invoices where id = '$INVOICE_A';")"
NUM_B="$(psql "$DB_URL" -tA -c "select invoice_number from invoices where id = '$INVOICE_B';")"

echo
echo "Result: invoice A got invoice_number=$NUM_A, invoice B got invoice_number=$NUM_B."

FAIL=0

if [ "$NUM_A" != "1" ] || [ "$NUM_B" != "2" ]; then
  echo "FAIL: expected invoice A=1 and invoice B=2 (sequential, no gap, no duplicate), got A=$NUM_A, B=$NUM_B" >&2
  FAIL=1
fi

# B's end time must be AFTER A's end time (~4s after A's start) -- proof
# that B's issue_invoice() call genuinely blocked on A's row lock rather
# than racing through independently while A was mid-transaction.
B_WAITED="$(python3 -c "print(1 if $session_b_end >= $session_a_end - 0.5 else 0)" 2>/dev/null || awk "BEGIN{print ($session_b_end >= $session_a_end - 0.5) ? 1 : 0}")"
if [ "$B_WAITED" != "1" ]; then
  echo "FAIL: session B finished before session A released its lock (B_end=$session_b_end, A_end=$session_a_end) -- this means the two issue_invoice() calls did NOT actually serialize on the counter row, and the concurrency-safety claim is unproven" >&2
  FAIL=1
else
  echo "PASS: session B's issue_invoice() call did not complete until session A committed -- the row-lock serialization is real, not coincidental sequencing."
fi

if [ "$FAIL" -eq 0 ]; then
  echo
  echo "PASS: issue_invoice() is concurrency-safe -- two overlapping transactions issuing invoices for the same org got distinct, gapless, correctly-ordered invoice numbers (1, 2), with the second call provably blocking on the first's row lock rather than racing it."
  exit 0
else
  exit 1
fi
