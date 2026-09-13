-- Gate 4 (Quotes & Payments), Phase A / 20260806000047_invoices.sql.
-- Proves:
--   1. Draft-mutable RLS, same shape as estimates.
--   2. issue_invoice(): role-gated, draft-required, assigns the correct
--      sequential per-org invoice_number (starting at 1), and produces the
--      immutable issued_* snapshot.
--   3. Per-org independence: org A's and org B's counters do not interact
--      (both start at 1).
--   4. void_invoice(): role-gated, issued-required, and does NOT reclaim the
--      voided invoice's number for the next one issued (gap preserved).
--   5. The issued/draft CHECK constraints hold.
--   6. Tenant isolation.
--
-- NOTE on concurrency: this file exercises SEQUENTIAL correctness only
-- (numbers 1, 2, 3, ... in a single connection). A single *.test.sql file
-- run by one `psql -f` process cannot exercise genuine lock contention
-- between two overlapping transactions -- the real concurrency proof is
-- scripts/test-invoice-number-concurrency.sh, which runs two actual
-- backgrounded psql processes against the same org's counter row.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
   'org-a-member-inv@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
   'org-a-permit-manager-inv@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e2', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client'),
  ('61000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Client')
on conflict (id) do nothing;

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1: plain member drafts an invoice for org A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into invoices (org_id, client_id, due_date) values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', current_date + 30)
  returning id into v_id;
  insert into _test_ids (label, id) values ('inv_a1', v_id);

  insert into invoice_line_items (org_id, invoice_id, description, quantity, unit_price_cents)
  values ('20000000-0000-0000-0000-00000000000a', v_id, 'Materials', 1, 50000);

  raise notice 'PASS: plain member drafts an invoice + line item for org A (id=%).', v_id;
end $$;

-- Step 2 (CHECK constraint): a draft row cannot carry an invoice_number.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'inv_a1';
  begin
    update invoices set invoice_number = 999 where id = v_id;
    raise exception 'FAIL: a draft invoice accepted an invoice_number';
  exception
    when check_violation then
      raise notice 'PASS: a draft invoice cannot carry an invoice_number (%)', sqlerrm;
  end;
end $$;

-- Step 3 (privilege boundary): a plain member cannot issue_invoice().
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'inv_a1';
  begin
    perform issue_invoice(v_id, '[]'::jsonb, 50000, 0, 0, 50000);
    raise exception 'FAIL: plain member was able to issue_invoice()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling issue_invoice() (%)', sqlerrm;
  end;
end $$;

-- Step 4 (issue_invoice, positive, org A's first invoice -> number 1).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_inv invoices;
begin
  select id into v_id from _test_ids where label = 'inv_a1';
  select * into v_inv from issue_invoice(v_id, '[{"description":"Materials","quantity":1,"unit_price_cents":50000}]'::jsonb, 50000, 0, 0, 50000, 'sha256:testhash1');

  if v_inv.status <> 'issued' or v_inv.invoice_number <> 1 then
    raise exception 'FAIL: expected org A''s first invoice to be issued with invoice_number 1, got status=%, invoice_number=%', v_inv.status, v_inv.invoice_number;
  end if;
  if v_inv.issued_total_cents <> 50000 or v_inv.issued_line_items is null then
    raise exception 'FAIL: issued snapshot not populated correctly (issued_total_cents=%, issued_line_items=%)', v_inv.issued_total_cents, v_inv.issued_line_items;
  end if;
  raise notice 'PASS: issue_invoice() assigns invoice_number 1 to org A''s first invoice and populates the immutable issued_* snapshot.';
end $$;

-- Step 5: a second draft + issue for org A -> number 2 (sequential).
do $$
declare
  v_id uuid;
  v_inv invoices;
begin
  insert into invoices (org_id, client_id) values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
  returning id into v_id;
  insert into _test_ids (label, id) values ('inv_a2', v_id);

  select * into v_inv from issue_invoice(v_id, '[]'::jsonb, 10000, 0, 0, 10000);
  if v_inv.invoice_number <> 2 then
    raise exception 'FAIL: expected org A''s second invoice to get invoice_number 2, got %', v_inv.invoice_number;
  end if;
  raise notice 'PASS: org A''s second issued invoice gets sequential invoice_number 2.';
end $$;

-- Step 6 (per-org independence): org B's first invoice ALSO gets number 1
-- -- proves the counter is per-org, not global.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_inv invoices;
begin
  insert into invoices (org_id, client_id) values ('20000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000b')
  returning id into v_id;
  insert into _test_ids (label, id) values ('inv_b1', v_id);

  select * into v_inv from issue_invoice(v_id, '[]'::jsonb, 5000, 0, 0, 5000);
  if v_inv.invoice_number <> 1 then
    raise exception 'FAIL: expected org B''s first invoice to get invoice_number 1 (independent counter), got %', v_inv.invoice_number;
  end if;
  raise notice 'PASS: org B''s counter is independent of org A''s -- its first invoice also gets invoice_number 1.';
end $$;

reset role;

-- Step 7 (void_invoice, privilege boundary + positive + gap-preserving):
-- void org A's invoice #1, then issue a third invoice for org A and confirm
-- it gets number 3, not the reclaimed number 1.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'inv_a1';
  begin
    perform void_invoice(v_id, 'test void attempt by plain member');
    raise exception 'FAIL: plain member was able to void_invoice()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling void_invoice() (%)', sqlerrm;
  end;
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_inv invoices;
begin
  select id into v_id from _test_ids where label = 'inv_a1';
  select * into v_inv from void_invoice(v_id, 'issued in error');
  if v_inv.status <> 'void' or v_inv.voided_at is null or v_inv.invoice_number <> 1 then
    raise exception 'FAIL: void_invoice() did not correctly void invoice #1 (status=%, voided_at=%, invoice_number=%)', v_inv.status, v_inv.voided_at, v_inv.invoice_number;
  end if;
  raise notice 'PASS: void_invoice() voids invoice #1, keeping its original invoice_number on the row.';
end $$;

do $$
declare
  v_id uuid;
  v_inv invoices;
begin
  insert into invoices (org_id, client_id) values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
  returning id into v_id;
  select * into v_inv from issue_invoice(v_id, '[]'::jsonb, 1000, 0, 0, 1000);
  if v_inv.invoice_number <> 3 then
    raise exception 'FAIL: expected the next issued invoice to get invoice_number 3 (voided #1 not reclaimed), got %', v_inv.invoice_number;
  end if;
  raise notice 'PASS: voiding invoice #1 does not reclaim its number -- the next issued invoice gets 3, preserving the gap.';
end $$;

-- Step 8 (invalid_transition): void_invoice() on an already-void invoice fails.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'inv_a1';
  begin
    perform void_invoice(v_id, 'double void attempt');
    raise exception 'FAIL: void_invoice() on an already-void invoice succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: void_invoice() on an already-void invoice is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 9 (tenant isolation): org B cannot see org A's invoices.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from invoices where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s invoices';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s invoices.';
end $$;

reset role;

rollback;
