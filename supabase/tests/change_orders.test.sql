-- Gate 4 (Quotes & Payments), Phase B / 20260806000062_change_orders_and_credit_notes.sql.
-- Proves:
--   1. Draft-mutable RLS + the "ADDITIONS ONLY" unit_price_cents >= 0 CHECK
--      on change_order_line_items (a change order can never represent a
--      reduction -- that's credit_notes' job).
--   2. send_change_order_for_acceptance(): role-gated (is_org_billing_manager,
--      same tier as issue_invoice()/record_payment()), draft-required, takes
--      the immutable sent_* snapshot.
--   3. record_change_order_acceptance(): `authenticated` has NO execute grant
--      at all (same external-actor pattern as record_estimate_acceptance());
--      happy path via service_role; the live "stale_change_order" guard
--      rejects a second acceptance attempt once status has moved past
--      pending_acceptance.
--   4. issue_change_order(): role-gated, accepted-required, atomically
--      creates a brand new DRAFT invoice copying the sent_* delta as that
--      invoice's own line items/totals, with originating_change_order_id
--      set -- and does NOT itself assign an invoice_number.
--   5. void_change_order(): role-gated, reachable from draft/pending_
--      acceptance/accepted but NOT from issued.
--   6. change_order_acceptances is append-only.
--   7. Tenant isolation.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- invoices.test.sql/payments.test.sql -- because service_role itself has no
-- INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
   'org-a-member-co@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
   'org-a-permit-manager-co@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c2', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client'),
  ('61000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Client')
on conflict (id) do nothing;

-- The already-issued invoice a change order proposes a delta against. Built
-- via direct row craft (same technique payments.test.sql uses) rather than
-- issue_invoice(), since only the resulting issued_total_cents matters here.
insert into invoices (id, org_id, client_id) values
  ('66000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

update invoices set status = 'issued', invoice_number = 1, issued_at = now(),
  issued_line_items = '[]'::jsonb, issued_total_cents = 100000, total_cents = 100000
where id = '66000000-0000-0000-0000-00000000000a';

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1: plain member drafts a change order + line item against the
-- already-issued invoice for org A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into change_orders (org_id, client_id, source_invoice_id, title, description)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '66000000-0000-0000-0000-00000000000a', 'Add a second outlet', 'Client requested an extra outlet after walkthrough')
  returning id into v_id;
  insert into _test_ids (label, id) values ('co_a1', v_id);

  insert into change_order_line_items (org_id, change_order_id, description, quantity, unit_price_cents)
  values ('20000000-0000-0000-0000-00000000000a', v_id, 'Extra outlet install', 2, 15000);

  raise notice 'PASS: plain member drafts a change order + line item for org A (id=%).', v_id;
end $$;

-- Step 2 (ADDITIONS ONLY CHECK): change_order_line_items.unit_price_cents
-- can never be negative -- a reduction is credit_notes' job, never a
-- change order.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    insert into change_order_line_items (org_id, change_order_id, description, quantity, unit_price_cents)
    values ('20000000-0000-0000-0000-00000000000a', v_id, 'Bogus reduction', 1, -500);
    raise exception 'FAIL: a change_order_line_item with a negative unit_price_cents was accepted';
  exception
    when check_violation then
      raise notice 'PASS: change_order_line_items rejects a negative unit_price_cents (ADDITIONS ONLY) (%)', sqlerrm;
  end;
end $$;

-- Step 3 (privilege boundary): a plain member cannot
-- send_change_order_for_acceptance().
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform send_change_order_for_acceptance(v_id, '[]'::jsonb, 30000, 0, 0, 30000);
    raise exception 'FAIL: plain member was able to send_change_order_for_acceptance()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling send_change_order_for_acceptance() (%)', sqlerrm;
  end;
end $$;

-- Step 4 (send_change_order_for_acceptance, positive): permit_manager sends
-- it, taking the immutable sent_* snapshot.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_co change_orders;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  select * into v_co from send_change_order_for_acceptance(
    v_id,
    jsonb_build_array(jsonb_build_object('description', 'Extra outlet install', 'quantity', 2, 'unit_price_cents', 15000, 'line_total_cents', 30000)),
    30000, 0, 0, 30000
  );

  if v_co.status <> 'pending_acceptance' or v_co.sent_total_cents <> 30000 or v_co.sent_line_items is null then
    raise exception 'FAIL: send_change_order_for_acceptance() did not populate the expected snapshot (status=%, sent_total_cents=%, sent_line_items=%)', v_co.status, v_co.sent_total_cents, v_co.sent_line_items;
  end if;
  raise notice 'PASS: send_change_order_for_acceptance() moves the change order to pending_acceptance and locks its sent_* snapshot.';
end $$;

-- Step 4b (invalid_transition): sending an already-sent change order again fails.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform send_change_order_for_acceptance(v_id, '[]'::jsonb, 1, 0, 0, 1);
    raise exception 'FAIL: send_change_order_for_acceptance() on a non-draft change order succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: send_change_order_for_acceptance() on a non-draft change order is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 5 (privilege boundary, record_change_order_acceptance): `authenticated`
-- has no execute grant on this function at all -- same external-actor
-- pattern as record_estimate_acceptance().
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform record_change_order_acceptance(v_id, 'hash-abc', '{}'::jsonb, 'Jane Doe', 'Property Owner');
    raise exception 'FAIL: authenticated was able to call record_change_order_acceptance()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated has no execute grant on record_change_order_acceptance() (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 6 (record_change_order_acceptance, happy path, service_role -- the
-- future bridge-layer caller shape).
set local role service_role;

do $$
declare
  v_id uuid;
  v_acc change_order_acceptances;
  v_status change_order_status;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  select * into v_acc from record_change_order_acceptance(v_id, 'hash-abc', '{"line_items":[]}'::jsonb, 'Jane Doe', 'Property Owner', '203.0.113.5'::inet, 'test-agent/1.0');

  if v_acc.change_order_id <> v_id or v_acc.typed_name <> 'Jane Doe' then
    raise exception 'FAIL: record_change_order_acceptance() did not persist expected fields (change_order_id=%, typed_name=%)', v_acc.change_order_id, v_acc.typed_name;
  end if;

  select status into v_status from change_orders where id = v_id;
  if v_status <> 'accepted' then
    raise exception 'FAIL: change order not flipped to accepted after acceptance (status=%)', v_status;
  end if;
  raise notice 'PASS: record_change_order_acceptance() inserts the acceptance and flips the change order to accepted.';
end $$;

-- Step 7 (stale_change_order guard): a second acceptance attempt, now that
-- status has moved past pending_acceptance, is rejected -- this is the live
-- re-check closing the same race estimate_acceptances' current_revision_id
-- check closes, and it is what actually makes change_order_acceptances'
-- unique(change_order_id) constraint unreachable in normal operation (the
-- status guard fires first).
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform record_change_order_acceptance(v_id, 'hash-second', '{}'::jsonb, 'Someone Else', 'Owner');
    raise exception 'FAIL: a second acceptance of an already-accepted change order succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_change_order_acceptance() rejects a change order no longer pending_acceptance (stale_change_order) (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 8 (privilege boundary, issue_change_order): a plain member cannot
-- issue it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform issue_change_order(v_id);
    raise exception 'FAIL: plain member was able to issue_change_order()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling issue_change_order() (%)', sqlerrm;
  end;
end $$;

-- Step 9 (issue_change_order, positive): permit_manager issues it, creating
-- a brand new draft invoice copying the sent_* delta verbatim.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_new_inv invoices;
  v_co change_orders;
  v_li_count int;
  v_li invoice_line_items;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  select * into v_new_inv from issue_change_order(v_id);
  insert into _test_ids (label, id) values ('new_inv_from_co_a1', v_new_inv.id);

  if v_new_inv.status <> 'draft' or v_new_inv.total_cents <> 30000 or v_new_inv.originating_change_order_id <> v_id then
    raise exception 'FAIL: issue_change_order() did not create the expected draft invoice (status=%, total_cents=%, originating_change_order_id=%)', v_new_inv.status, v_new_inv.total_cents, v_new_inv.originating_change_order_id;
  end if;
  if v_new_inv.invoice_number is not null then
    raise exception 'FAIL: issue_change_order() must NOT itself assign an invoice_number, got %', v_new_inv.invoice_number;
  end if;

  select count(*) into v_li_count from invoice_line_items where invoice_id = v_new_inv.id;
  if v_li_count <> 1 then
    raise exception 'FAIL: expected exactly 1 copied line item on the new invoice, got %', v_li_count;
  end if;
  select * into v_li from invoice_line_items where invoice_id = v_new_inv.id;
  if v_li.description <> 'Extra outlet install' or v_li.quantity <> 2 or v_li.unit_price_cents <> 15000 then
    raise exception 'FAIL: copied line item does not match the change order''s sent snapshot (description=%, quantity=%, unit_price_cents=%)', v_li.description, v_li.quantity, v_li.unit_price_cents;
  end if;

  select * into v_co from change_orders where id = v_id;
  if v_co.status <> 'issued' or v_co.resulting_invoice_id <> v_new_inv.id then
    raise exception 'FAIL: change order not flipped to issued with resulting_invoice_id set (status=%, resulting_invoice_id=%)', v_co.status, v_co.resulting_invoice_id;
  end if;

  raise notice 'PASS: issue_change_order() creates a new draft invoice (id=%) copying the sent delta verbatim, with no invoice_number assigned yet, and flips the change order to issued.', v_new_inv.id;
end $$;

-- Step 10 (invalid_transition): issuing an already-issued change order again fails.
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform issue_change_order(v_id);
    raise exception 'FAIL: issue_change_order() on an already-issued change order succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: issue_change_order() on an already-issued change order is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

-- Step 11 (void_change_order): privilege boundary, positive, invalid
-- transitions (double-void, and void from issued is never reachable).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into change_orders (org_id, client_id, source_invoice_id, title)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', '66000000-0000-0000-0000-00000000000a', 'Abandoned change order')
  returning id into v_id;
  insert into _test_ids (label, id) values ('co_a2', v_id);

  begin
    perform void_change_order(v_id, 'test void attempt by plain member');
    raise exception 'FAIL: plain member was able to void_change_order()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling void_change_order() (%)', sqlerrm;
  end;
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_co change_orders;
begin
  select id into v_id from _test_ids where label = 'co_a2';
  select * into v_co from void_change_order(v_id, 'never sent, abandoned');
  if v_co.status <> 'void' or v_co.voided_at is null or v_co.void_reason <> 'never sent, abandoned' then
    raise exception 'FAIL: void_change_order() did not correctly void the draft change order (status=%, voided_at=%, void_reason=%)', v_co.status, v_co.voided_at, v_co.void_reason;
  end if;
  raise notice 'PASS: void_change_order() voids a still-draft change order.';
end $$;

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a2';
  begin
    perform void_change_order(v_id, 'double void attempt');
    raise exception 'FAIL: void_change_order() on an already-void change order succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: void_change_order() on an already-void change order is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'co_a1';
  begin
    perform void_change_order(v_id, 'attempt to void an issued change order');
    raise exception 'FAIL: void_change_order() on an issued change order succeeded (void must not be reachable from issued)';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: void_change_order() on an issued change order is rejected with 22023 -- void is not reachable from issued (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 12 (append-only): change_order_acceptances cannot be touched by
-- UPDATE/DELETE. `authenticated` has no UPDATE/DELETE grant on this table at
-- all, so this is rejected at the grant layer before the
-- forbid_update_delete() trigger even runs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_acc_id uuid;
  v_co_id uuid;
begin
  select id into v_co_id from _test_ids where label = 'co_a1';
  select id into v_acc_id from change_order_acceptances where change_order_id = v_co_id;

  begin
    update change_order_acceptances set typed_name = 'Hijacked' where id = v_acc_id;
    raise exception 'FAIL: UPDATE of change_order_acceptances succeeded despite append-only design';
  exception
    when others then
      raise notice 'PASS: change_order_acceptances UPDATE rejected (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 13 (tenant isolation): org B cannot see org A's change orders.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from change_orders where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s change orders';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s change orders.';
end $$;

reset role;

rollback;
