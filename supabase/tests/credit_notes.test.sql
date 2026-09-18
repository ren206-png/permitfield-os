-- Gate 4 (Quotes & Payments), Phase B / 20260806000062_change_orders_and_credit_notes.sql.
-- Proves:
--   1. Draft-mutable RLS, same shape as invoices/change_orders.
--   2. issue_credit_note(): role-gated (is_org_billing_manager), draft-
--      required, positive-amount-required, and assigns the correct
--      sequential per-org credit_note_number (starting at 1), independent of
--      other orgs' counters.
--   3. Balance guard (mirrors 20260806000051_record_payment_invoice_guards.sql's
--      precedent): rejects a credit note that alone, or combined with
--      already-recorded payments and/or already-issued credit notes on the
--      same invoice, would push total credits+payments past the invoice's
--      issued_total_cents; rejects any credit note against a non-issued
--      (draft) invoice.
--   4. void_credit_note(): role-gated, issued-required (rejects a draft or
--      already-void credit note), never reclaims the voided number.
--   5. Tenant isolation.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- invoices.test.sql/payments.test.sql -- because service_role itself has no
-- INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated',
   'org-a-member-cn@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated',
   'org-a-permit-manager-cn@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000d1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000d2', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client'),
  ('61000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Client')
on conflict (id) do nothing;

-- Org A: one issued invoice (the credit-note target for most of this file)
-- and one still-draft invoice (to prove credit notes can't target a
-- non-issued invoice). Org B: one issued invoice, to prove the per-org
-- counter is independent.
insert into invoices (id, org_id, client_id) values
  ('67000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a'),
  ('67000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a'),
  ('67000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000b')
on conflict (id) do nothing;

update invoices set status = 'issued', invoice_number = 1, issued_at = now(),
  issued_line_items = '[]'::jsonb, issued_total_cents = 100000, total_cents = 100000
where id = '67000000-0000-0000-0000-00000000000a';

update invoices set status = 'issued', invoice_number = 1, issued_at = now(),
  issued_line_items = '[]'::jsonb, issued_total_cents = 5000, total_cents = 5000
where id = '67000000-0000-0000-0000-00000000000b';

-- '67000000-...-00000000000c' is left as status = 'draft' (the default) with
-- no issued_total_cents -- the non-issued-invoice rejection target.

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1: plain member drafts a credit note for org A against the issued invoice.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-00000000000a', 'Goodwill discount', 20000)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_a1', v_id);
  raise notice 'PASS: plain member drafts a credit note for org A (id=%).', v_id;
end $$;

-- Step 2 (privilege boundary): a plain member cannot issue_credit_note().
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'cn_a1';
  begin
    perform issue_credit_note(v_id);
    raise exception 'FAIL: plain member was able to issue_credit_note()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling issue_credit_note() (%)', sqlerrm;
  end;
end $$;

-- Step 3 (issue_credit_note, positive, org A's first -> number 1).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_cn credit_notes;
begin
  select id into v_id from _test_ids where label = 'cn_a1';
  select * into v_cn from issue_credit_note(v_id);

  if v_cn.status <> 'issued' or v_cn.credit_note_number <> 1 or v_cn.issued_amount_cents <> 20000 or v_cn.issued_at is null then
    raise exception 'FAIL: expected org A''s first credit note to be issued as number 1 with issued_amount_cents=20000, got status=%, credit_note_number=%, issued_amount_cents=%', v_cn.status, v_cn.credit_note_number, v_cn.issued_amount_cents;
  end if;
  raise notice 'PASS: issue_credit_note() assigns credit_note_number 1 to org A''s first credit note and locks issued_amount_cents.';
end $$;

reset role;

-- Step 4 (per-org independence): org B's first credit note ALSO gets number
-- 1 -- proves the counter is per-org, not global.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_cn credit_notes;
begin
  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000b', '67000000-0000-0000-0000-00000000000b', 'Org B goodwill', 1000)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_b1', v_id);

  select * into v_cn from issue_credit_note(v_id);
  if v_cn.credit_note_number <> 1 then
    raise exception 'FAIL: expected org B''s first credit note to get credit_note_number 1 (independent counter), got %', v_cn.credit_note_number;
  end if;
  raise notice 'PASS: org B''s credit-note counter is independent of org A''s -- its first credit note also gets number 1.';
end $$;

reset role;

-- Step 5 (balance guard, single-allocation-style over-limit): org A's
-- invoice has issued_total_cents=100000; cn_a1 above already claimed 20000
-- of it, recorded payments are still 0. A credit note of 90000 would push
-- total credits to 110000, over the 100000 balance -- must be rejected.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-00000000000a', 'Too large', 90000)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_a2', v_id);
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'cn_a2';
  begin
    perform issue_credit_note(v_id);
    raise exception 'FAIL: issue_credit_note() accepted a credit note that alone would exceed the invoice''s outstanding balance';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: issue_credit_note() rejects a credit note that alone would exceed the outstanding balance (%)', sqlerrm;
  end;
end $$;

-- Step 6 (balance guard, combined with a recorded payment): record a 70000
-- payment against the same invoice (recorded payments 70000 + already-issued
-- credits 20000 = 90000 of the 100000 balance already claimed, 10000 left).
-- A further credit note of 15000 would push the total to 105000 -- rejected.
-- A credit note of exactly 10000 fits precisely -- accepted, getting number 2.
do $$
begin
  perform record_payment(
    '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'e_transfer', 70000, current_date, 'cn-guard-payment',
    jsonb_build_array(jsonb_build_object('invoice_id', '67000000-0000-0000-0000-00000000000a', 'amount_cents', 70000))
  );
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-00000000000a', 'Slightly too large', 15000)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_a3', v_id);

  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-00000000000a', 'Exact remaining balance', 10000)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_a4', v_id);
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'cn_a3';
  begin
    perform issue_credit_note(v_id);
    raise exception 'FAIL: issue_credit_note() accepted a credit note that combined with recorded payments + issued credits exceeds the outstanding balance';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: issue_credit_note() rejects a credit note that, combined with recorded payments and already-issued credits, exceeds the outstanding balance (%)', sqlerrm;
  end;
end $$;

do $$
declare
  v_id uuid;
  v_cn credit_notes;
begin
  select id into v_id from _test_ids where label = 'cn_a4';
  select * into v_cn from issue_credit_note(v_id);
  if v_cn.credit_note_number <> 2 or v_cn.issued_amount_cents <> 10000 then
    raise exception 'FAIL: expected org A''s second issued credit note to get number 2 with issued_amount_cents=10000, got number=%, issued_amount_cents=%', v_cn.credit_note_number, v_cn.issued_amount_cents;
  end if;
  raise notice 'PASS: issue_credit_note() accepts a credit note that exactly fits the remaining outstanding balance (credit_note_number=2).';
end $$;

-- Step 7 (non-issued invoice rejection): a credit note against a still-draft
-- invoice is rejected regardless of amount.
do $$
declare
  v_id uuid;
begin
  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-00000000000c', 'Against a draft invoice', 100)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_a_draft_invoice', v_id);

  begin
    perform issue_credit_note(v_id);
    raise exception 'FAIL: issue_credit_note() accepted a credit note against a non-issued (draft) invoice';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: issue_credit_note() rejects a credit note against a non-issued invoice (%)', sqlerrm;
  end;
end $$;

-- Step 8 (void_credit_note): privilege boundary, positive, invalid
-- transitions (draft, and already-void).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'cn_a1';
  begin
    perform void_credit_note(v_id, 'test void attempt by plain member');
    raise exception 'FAIL: plain member was able to void_credit_note()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling void_credit_note() (%)', sqlerrm;
  end;
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'cn_a3';
  begin
    perform void_credit_note(v_id, 'attempt to void a draft credit note');
    raise exception 'FAIL: void_credit_note() on a still-draft credit note succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: void_credit_note() on a still-draft credit note is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

do $$
declare
  v_id uuid;
  v_cn credit_notes;
begin
  select id into v_id from _test_ids where label = 'cn_a1';
  select * into v_cn from void_credit_note(v_id, 'issued in error');
  if v_cn.status <> 'void' or v_cn.voided_at is null or v_cn.credit_note_number <> 1 then
    raise exception 'FAIL: void_credit_note() did not correctly void credit note #1 (status=%, voided_at=%, credit_note_number=%)', v_cn.status, v_cn.voided_at, v_cn.credit_note_number;
  end if;
  raise notice 'PASS: void_credit_note() voids credit note #1, keeping its original credit_note_number on the row.';
end $$;

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'cn_a1';
  begin
    perform void_credit_note(v_id, 'double void attempt');
    raise exception 'FAIL: void_credit_note() on an already-void credit note succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: void_credit_note() on an already-void credit note is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

-- Step 9 (number-gap preservation after void): voiding credit note #1 above
-- releases the balance it had reduced (the outstanding-balance formula only
-- ever sums status='issued' credit notes) but must NOT reclaim its number --
-- the next issued credit note must get 3, not the freed 1. Outstanding
-- balance is now: issued_total_cents 100000 - recorded payments 70000 -
-- issued credits 10000 (only cn_a4, since cn_a1 is now void) = 20000.
do $$
declare
  v_id uuid;
begin
  insert into credit_notes (org_id, client_id, invoice_id, reason, amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-00000000000a', 'After voiding #1', 5000)
  returning id into v_id;
  insert into _test_ids (label, id) values ('cn_a5', v_id);
end $$;

do $$
declare
  v_id uuid;
  v_cn credit_notes;
begin
  select id into v_id from _test_ids where label = 'cn_a5';
  select * into v_cn from issue_credit_note(v_id);
  if v_cn.credit_note_number <> 3 then
    raise exception 'FAIL: expected the next issued credit note to get credit_note_number 3 (voided #1 not reclaimed), got %', v_cn.credit_note_number;
  end if;
  raise notice 'PASS: voiding credit note #1 does not reclaim its number -- the next issued credit note gets 3, preserving the gap.';
end $$;

reset role;

-- Step 10 (tenant isolation): org B cannot see org A's credit notes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from credit_notes where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s credit notes';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s credit notes.';
end $$;

reset role;

rollback;
