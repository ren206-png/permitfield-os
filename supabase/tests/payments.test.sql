-- Gate 4 (Quotes & Payments), Phase A / 20260806000056_payments.sql.
-- Proves:
--   1. `authenticated` has no direct INSERT/UPDATE grant on
--      payments/payment_allocations at all -- every write goes through
--      record_payment()/reverse_payment(), both role-gated.
--   2. record_payment(): role gate, allocation-sum integrity check, and
--      atomic creation of the payment + its allocations.
--   3. reverse_payment(): role gate, recorded-status-required, and leaves
--      payment_allocations rows untouched (correction model: new status +
--      new row, never edit/delete of the original).
--   4. Tenant isolation.
--   5. (20260806000058 regression) record_payment() rejects: a single
--      allocation exceeding an invoice's outstanding balance, MULTIPLE
--      allocations against the SAME invoice within one call whose sum
--      exceeds the balance (the actual adversarial-review bug -- see that
--      migration's header comment), and any allocation at all against a
--      non-issued (voided) invoice.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
   'org-a-member-pay@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
   'org-a-permit-manager-pay@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client')
on conflict (id) do nothing;

insert into invoices (id, org_id, client_id) values
  ('65000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

update invoices set status = 'issued', invoice_number = 1, issued_at = now(),
  issued_line_items = '[]'::jsonb, issued_total_cents = 60000, total_cents = 60000
where id = '65000000-0000-0000-0000-00000000000a';

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1 (write boundary, negative): a plain member has no direct INSERT
-- grant on payments at all -- must go through record_payment().
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
begin
  begin
    insert into payments (org_id, client_id, method, amount_cents, received_at)
    values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 60000, current_date);
    raise exception 'FAIL: authenticated direct INSERT into payments succeeded';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated direct INSERT into payments is rejected (%)', sqlerrm;
  end;
end $$;

-- Step 2 (privilege boundary, record_payment): a plain member cannot call
-- record_payment() either.
do $$
begin
  begin
    perform record_payment('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 60000, current_date);
    raise exception 'FAIL: plain member was able to call record_payment()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling record_payment() (%)', sqlerrm;
  end;
end $$;

-- Step 3 (record_payment, allocation-sum integrity): a mismatched
-- allocation total is rejected.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
begin
  begin
    perform record_payment(
      '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 60000, current_date, 'ref-mismatch',
      jsonb_build_array(jsonb_build_object('invoice_id', '65000000-0000-0000-0000-00000000000a', 'amount_cents', 40000))
    );
    raise exception 'FAIL: record_payment() accepted an allocation total that does not match the payment amount';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_payment() rejects a mismatched allocation total (%)', sqlerrm;
  end;
end $$;

-- Step 4 (record_payment, positive): a matching allocation succeeds and
-- creates both the payment and its allocation atomically.
do $$
declare
  v_payment payments;
  v_alloc_count int;
  v_alloc_total bigint;
begin
  select * into v_payment from record_payment(
    '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 60000, current_date, 'e-transfer-ref-001',
    jsonb_build_array(jsonb_build_object('invoice_id', '65000000-0000-0000-0000-00000000000a', 'amount_cents', 60000))
  );
  insert into _test_ids (label, id) values ('payment_a1', v_payment.id);

  if v_payment.status <> 'recorded' or v_payment.amount_cents <> 60000 then
    raise exception 'FAIL: record_payment() did not persist the payment as expected (status=%, amount_cents=%)', v_payment.status, v_payment.amount_cents;
  end if;

  select count(*), coalesce(sum(amount_cents), 0) into v_alloc_count, v_alloc_total from payment_allocations where payment_id = v_payment.id;
  if v_alloc_count <> 1 or v_alloc_total <> 60000 then
    raise exception 'FAIL: record_payment() did not create the expected allocation (count=%, total=%)', v_alloc_count, v_alloc_total;
  end if;
  raise notice 'PASS: record_payment() atomically creates the payment (id=%) and its matching allocation.', v_payment.id;
end $$;

-- Step 5 (privilege boundary, reverse_payment): a plain member cannot reverse it.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'payment_a1';
  begin
    perform reverse_payment(v_id, 'test reversal attempt by plain member');
    raise exception 'FAIL: plain member was able to call reverse_payment()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling reverse_payment() (%)', sqlerrm;
  end;
end $$;

-- Step 6 (reverse_payment, positive): the correction model -- status flips
-- to 'reversed', original row's amount/method/allocations untouched.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_payment payments;
  v_alloc_count int;
begin
  select id into v_id from _test_ids where label = 'payment_a1';
  select * into v_payment from reverse_payment(v_id, 'recorded against the wrong invoice');

  if v_payment.status <> 'reversed' or v_payment.amount_cents <> 60000 or v_payment.reversed_by is null then
    raise exception 'FAIL: reverse_payment() did not correctly reverse the payment (status=%, amount_cents=%, reversed_by=%)', v_payment.status, v_payment.amount_cents, v_payment.reversed_by;
  end if;

  select count(*) into v_alloc_count from payment_allocations where payment_id = v_id;
  if v_alloc_count <> 1 then
    raise exception 'FAIL: reverse_payment() touched payment_allocations (expected untouched, count=%)', v_alloc_count;
  end if;
  raise notice 'PASS: reverse_payment() flips status to reversed, keeps the original amount and leaves allocations untouched.';
end $$;

-- Step 7 (invalid_transition): reversing an already-reversed payment fails.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'payment_a1';
  begin
    perform reverse_payment(v_id, 'double reversal attempt');
    raise exception 'FAIL: reverse_payment() on an already-reversed payment succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: reverse_payment() on an already-reversed payment is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

-- Step 7b (20260806000058 regression, single-allocation over-allocation):
-- payment_a1 above was reversed in Step 6/7, so it no longer counts toward
-- "already recorded" (reverse_payment() flips status, it does not delete
-- the allocation row -- record_payment()'s own already-recorded sum filters
-- on payments.status = 'recorded', so a reversed payment's old allocation is
-- correctly excluded here). The invoice's full 60000-cent balance is once
-- again unclaimed; a single allocation of 70000 against it must be rejected.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
begin
  begin
    perform record_payment(
      '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 70000, current_date, 'over-allocate-single',
      jsonb_build_array(jsonb_build_object('invoice_id', '65000000-0000-0000-0000-00000000000a', 'amount_cents', 70000))
    );
    raise exception 'FAIL: record_payment() accepted a single allocation exceeding the invoice''s outstanding balance';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_payment() rejects a single allocation exceeding the outstanding balance (%)', sqlerrm;
  end;
end $$;

-- Step 7c (20260806000058 regression, SAME-invoice split-allocation
-- bypass): the bug this migration actually closed. Two allocations of
-- 35000 each (70000 total) against the SAME invoice, in ONE
-- record_payment() call, split specifically so that no SINGLE entry
-- exceeds the 60000 balance on its own (35000 <= 60000) -- only their SUM
-- does. Before the v_pending_by_invoice fix, each entry was checked only
-- against already-COMMITTED rows (0, since nothing in this call has been
-- inserted yet), so both individually "passed" and the invoice ended up
-- over-allocated by 10000 cents with zero concurrency involved. Must still
-- be rejected with both entries in a single array.
do $$
begin
  begin
    perform record_payment(
      '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 70000, current_date, 'split-bypass-attempt',
      jsonb_build_array(
        jsonb_build_object('invoice_id', '65000000-0000-0000-0000-00000000000a', 'amount_cents', 35000),
        jsonb_build_object('invoice_id', '65000000-0000-0000-0000-00000000000a', 'amount_cents', 35000)
      )
    );
    raise exception 'FAIL: record_payment() accepted a same-invoice split allocation that together exceeds the outstanding balance';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_payment() rejects a same-invoice split allocation whose sum exceeds the outstanding balance (%)', sqlerrm;
  end;
end $$;

-- Step 7d (20260806000058 regression, voided invoice): void the invoice,
-- then confirm no allocation can be recorded against it at all, regardless
-- of amount.
do $$
begin
  perform void_invoice('65000000-0000-0000-0000-00000000000a', 'test void for payment-guard regression');
end $$;

do $$
begin
  begin
    perform record_payment(
      '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 100, current_date, 'void-invoice-attempt',
      jsonb_build_array(jsonb_build_object('invoice_id', '65000000-0000-0000-0000-00000000000a', 'amount_cents', 100))
    );
    raise exception 'FAIL: record_payment() accepted an allocation against a voided invoice';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_payment() rejects an allocation against a non-issued (voided) invoice (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 8 (tenant isolation): org B cannot see org A's payments.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from payments where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s payments';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s payments.';
end $$;

reset role;

rollback;
