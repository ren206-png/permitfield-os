-- Gate 4 (Quotes & Payments), Phase A -- security fix for record_payment()
-- (20260806000056_payments.sql). Adversarial review found that the original
-- function validated only that a payment's allocations *sum* to its own
-- amount (structural/arithmetic, per that migration's own comment), but
-- performed NO check on the target invoice(s) at all: it happily inserted a
-- payment_allocations row against an invoice regardless of that invoice's
-- status (draft/void) or its remaining outstanding balance.
--
-- Reproduced empirically against a local db: issue_invoice() -> void_invoice()
-- on a $100.00 invoice, then record_payment() with a single allocation of
-- $9,999,999.00 against that now-voided invoice -- this succeeded and wrote a
-- payment_allocations row for 999999900 cents against an invoice whose own
-- issued_total_cents is 10000. That is a real "phantom paid" / "double-spend
-- of a credit that was never issued" state: staff-facing balance math
-- (app/(app)/invoices/[id]/page.tsx and app/invoice/[token]/page.tsx) sums
-- payment_allocations with no upper bound and no invoice-status filter, so it
-- would report a negative/nonsensical outstanding balance, and a void
-- invoice would appear paid.
--
-- Fix: create or replace the existing function (never edit the already-
-- applied 20260806000049 file, per this gate's append-only migration
-- convention) to add, per allocation, inside the same transaction as the
-- payment insert:
--   1. `select ... for update` on the target invoice, scoped to p_org_id --
--      this both re-validates the invoice belongs to the paying org (a
--      cross-tenant allocation would previously have been caught later only
--      by the payment_allocations foreign key on (org_id, invoice_id), which
--      does enforce org-scoping but gives a generic FK error rather than a
--      clear message) and takes a row lock that is held for the rest of the
--      transaction.
--   2. Reject if the invoice is not `issued` (blocks allocations against
--      draft or void invoices).
--   3. Reject if the new allocation would push total recorded allocations
--      (existing 'recorded'-payment allocations + this one) past the
--      invoice's issued_total_cents (blocks over-allocation/"overpayment").
-- Holding the per-invoice row lock from step 1 through the final insert also
-- closes the race-condition variant of this same bug: two concurrent
-- record_payment() calls against the same invoice's remaining balance can no
-- longer both read "balance not yet exceeded" and both succeed, because the
-- second transaction blocks on the row lock until the first commits (or
-- rolls back) its allocation, then re-evaluates the now-updated balance --
-- the same "let a lock held across the whole statement/transaction be the
-- concurrency-safety mechanism" idea issue_invoice()'s own header comment
-- documents for invoice_number_counters, applied here to balance checking
-- instead of number allocation.
--
-- SECOND GAP, found and closed in the same pass (initial version of this
-- migration checked v_already_recorded from already-COMMITTED
-- payment_allocations rows only, per invoice, on every loop iteration --
-- but p_allocations is a single caller-supplied jsonb array, and nothing
-- stopped that array from containing MULTIPLE entries against the SAME
-- invoice_id within one record_payment() call. Each entry was validated
-- against the same pre-call v_already_recorded, since nothing had been
-- inserted yet -- so e.g. two $60 allocations against a $100-outstanding
-- invoice each individually passed "0 + 60 <= 100," letting a single call
-- over-allocate by $20 with zero concurrency involved at all. Reproduced
-- empirically before this fix: a single record_payment() call with
-- allocations [{invoice_id: X, amount_cents: 6000}, {invoice_id: X,
-- amount_cents: 6000}] against a $100.00 issued invoice inserted both rows,
-- leaving payment_allocations summing to $120 against a $100 invoice.
-- Fixed below by accumulating a running per-invoice total ACROSS the
-- in-flight p_allocations array itself (v_pending_by_invoice), in addition
-- to the already-committed v_already_recorded, and checking the SUM of both
-- before accepting each subsequent entry for that same invoice_id.
create or replace function record_payment(
  p_org_id uuid,
  p_client_id uuid,
  p_method payment_method,
  p_amount_cents bigint,
  p_received_at date,
  p_reference_note text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_alloc jsonb;
  v_allocated_total bigint := 0;
  v_invoice invoices;
  v_invoice_id uuid;
  v_alloc_amount bigint;
  v_already_recorded bigint;
  -- Running total of allocations against each invoice_id seen so far WITHIN
  -- this call's own p_allocations array (jsonb object, key = invoice_id::text,
  -- value = cumulative amount_cents) -- see header comment's "SECOND GAP"
  -- section for why this is required in addition to v_already_recorded.
  v_pending_by_invoice jsonb := '{}'::jsonb;
  v_prior_pending_cents bigint;
begin
  if not is_org_billing_manager(p_org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', p_org_id
      using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount_cents must be positive';
  end if;

  select coalesce(sum((elem->>'amount_cents')::bigint), 0) into v_allocated_total
  from jsonb_array_elements(p_allocations) as elem;

  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 and v_allocated_total <> p_amount_cents then
    raise exception 'invalid_transition: allocation total % does not equal payment amount %', v_allocated_total, p_amount_cents
      using errcode = '22023';
  end if;

  -- Validate every target invoice BEFORE inserting the payment row, so a
  -- rejected allocation never leaves behind an orphaned payment with zero
  -- allocations. Locks each distinct invoice row (for update) for the
  -- remainder of this transaction -- see header comment for why that closes
  -- the concurrent-overpayment race, not just the single-call case.
  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    v_invoice_id := (v_alloc->>'invoice_id')::uuid;
    v_alloc_amount := (v_alloc->>'amount_cents')::bigint;

    select * into v_invoice from invoices where id = v_invoice_id and org_id = p_org_id for update;
    if v_invoice.id is null then
      raise exception 'invalid_transition: invoice % not found in org %', v_invoice_id, p_org_id
        using errcode = '22023';
    end if;

    if v_invoice.status <> 'issued' then
      raise exception 'invalid_transition: invoice % is not in issued status (current: %), payments cannot be allocated to it',
        v_invoice_id, v_invoice.status
        using errcode = '22023';
    end if;

    select coalesce(sum(pa.amount_cents), 0) into v_already_recorded
    from payment_allocations pa
    join payments p on p.id = pa.payment_id
    where pa.invoice_id = v_invoice_id and pa.org_id = p_org_id and p.status = 'recorded';

    -- Amount already pending against this SAME invoice_id from an earlier
    -- entry in this same p_allocations array (0 the first time this
    -- invoice_id is seen in this call) -- must be added to v_already_recorded
    -- before checking, since nothing has been inserted into
    -- payment_allocations yet for any entry in this call.
    v_prior_pending_cents := coalesce((v_pending_by_invoice->>(v_invoice_id::text))::bigint, 0);

    if v_already_recorded + v_prior_pending_cents + v_alloc_amount > coalesce(v_invoice.issued_total_cents, 0) then
      raise exception 'invalid_transition: allocation of % cents to invoice % would exceed its outstanding balance (already recorded % + pending-in-this-call % of % cents)',
        v_alloc_amount, v_invoice_id, v_already_recorded, v_prior_pending_cents, v_invoice.issued_total_cents
        using errcode = '22023';
    end if;

    v_pending_by_invoice := jsonb_set(
      v_pending_by_invoice,
      array[v_invoice_id::text],
      to_jsonb(v_prior_pending_cents + v_alloc_amount)
    );
  end loop;

  insert into payments (org_id, client_id, method, amount_cents, received_at, reference_note, recorded_by)
  values (p_org_id, p_client_id, p_method, p_amount_cents, p_received_at, p_reference_note, auth.uid())
  returning * into v_payment;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    insert into payment_allocations (org_id, payment_id, invoice_id, amount_cents)
    values (p_org_id, v_payment.id, (v_alloc->>'invoice_id')::uuid, (v_alloc->>'amount_cents')::bigint);
  end loop;

  return v_payment;
end;
$$;

revoke all on function record_payment(uuid, uuid, payment_method, bigint, date, text, jsonb) from public;
grant execute on function record_payment(uuid, uuid, payment_method, bigint, date, text, jsonb) to authenticated;
grant execute on function record_payment(uuid, uuid, payment_method, bigint, date, text, jsonb) to service_role;
