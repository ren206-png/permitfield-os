-- Gate 4 (Quotes & Payments), Phase C / 20260806000063_stripe_connect_online_payments.sql.
-- Proves:
--   1. org_stripe_connect_accounts: RLS is member-read/no-direct-write --
--      `authenticated` can SELECT its own org's row (once one exists) but
--      has no INSERT/UPDATE grant at all; org B cannot see org A's row
--      (tenant isolation).
--   2. upsert_org_stripe_connect_account(): is_org_billing_manager() role
--      gate (plain member rejected, permit_manager allowed), and that
--      re-running it with a NEW Stripe account id (re-onboarding) updates
--      stripe_connect_account_id WITHOUT resetting an already-true
--      charges_enabled/payouts_enabled/details_submitted back to false --
--      the exact ON CONFLICT behavior the migration's own header comment
--      calls out.
--   3. update_org_stripe_connect_account_status(): service_role-only (never
--      granted to authenticated, even a billing manager); positive update;
--      raises when no matching stripe_connect_account_id row exists.
--   4. record_online_payment(): service_role-only; reproduces
--      record_payment()'s allocation-sum/issued-status invariants in SQL
--      (rejects over-allocation and non-issued invoices with 22023);
--      idempotent by stripe_payment_intent_id (a retried webhook delivery
--      returns the original row, does not double-insert).
--   5. reverse_online_payment_from_webhook(): service_role-only; flips
--      status to 'reversed' with reversed_by left NULL (the CHECK-
--      constraint relaxation this migration makes); idempotent on an
--      already-reversed payment; raises when no matching payment exists.
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/stripe_connect_online_payments.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A / Org B already exist from supabase/seed.sql PART 2
-- (20000000-...000a / ...000b, owners 10000000-...000a / ...000b). Two new
-- org A members here, same shape as payments.test.sql's own e1/e2 fixture:
-- a plain member (no billing-manager tier) and a permit_manager (which IS
-- a billing-manager tier per is_org_billing_manager()'s role list).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
   'org-a-member-connect@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
   'org-a-permit-manager-connect@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000c2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('62000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Connect Test Client')
on conflict (id) do nothing;

insert into invoices (id, org_id, client_id) values
  ('68000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

update invoices set status = 'issued', invoice_number = 101, issued_at = now(),
  issued_line_items = '[]'::jsonb, issued_total_cents = 60000, total_cents = 60000
where id = '68000000-0000-0000-0000-00000000000a';

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- === 1. org_stripe_connect_accounts: no direct write grant for authenticated ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  begin
    insert into org_stripe_connect_accounts (org_id, stripe_connect_account_id)
    values ('20000000-0000-0000-0000-00000000000a', 'acct_direct_insert_attempt');
    raise exception 'FAIL: authenticated direct INSERT into org_stripe_connect_accounts succeeded';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: authenticated direct INSERT into org_stripe_connect_accounts is rejected (%)', sqlerrm;
  end;
end $$;

-- === 2. upsert_org_stripe_connect_account(): role gate, plain member rejected ===
do $$
begin
  begin
    perform upsert_org_stripe_connect_account('20000000-0000-0000-0000-00000000000a', 'acct_test_001');
    raise exception 'FAIL: plain member was able to call upsert_org_stripe_connect_account()';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: plain member is rejected calling upsert_org_stripe_connect_account() (%)', sqlerrm;
  end;
end $$;

-- === 3. upsert_org_stripe_connect_account(): positive, billing-manager tier ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_row org_stripe_connect_accounts;
begin
  select * into v_row from upsert_org_stripe_connect_account('20000000-0000-0000-0000-00000000000a', 'acct_test_001');
  if v_row.stripe_connect_account_id <> 'acct_test_001'
     or v_row.charges_enabled is distinct from false
     or v_row.payouts_enabled is distinct from false
     or v_row.details_submitted is distinct from false then
    raise exception 'FAIL: upsert_org_stripe_connect_account() did not create the expected fresh row (account_id=%, charges_enabled=%, payouts_enabled=%, details_submitted=%)',
      v_row.stripe_connect_account_id, v_row.charges_enabled, v_row.payouts_enabled, v_row.details_submitted;
  end if;
  raise notice 'PASS: upsert_org_stripe_connect_account() creates a fresh row with all three Stripe status flags defaulted false.';
end $$;

-- === 3b. authenticated (own org, any member) can SELECT the row that now exists ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from org_stripe_connect_accounts where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 1 then
    raise exception 'FAIL: plain org A member could not SELECT org A''s own org_stripe_connect_accounts row (count=%)', v_count;
  end if;
  raise notice 'PASS: a plain org member (not just the billing manager who created it) can SELECT the org''s own Connect account row.';
end $$;

reset role;

-- === 4. update_org_stripe_connect_account_status(): never granted to authenticated, even a billing manager ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  begin
    perform update_org_stripe_connect_account_status('acct_test_001', true, true, true);
    raise exception 'FAIL: authenticated (billing manager) was able to call update_org_stripe_connect_account_status()';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: update_org_stripe_connect_account_status() is rejected for authenticated regardless of role tier (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 5. update_org_stripe_connect_account_status(): service_role positive + unknown-account-id failure ===
set local role service_role;

do $$
declare
  v_row org_stripe_connect_accounts;
begin
  select * into v_row from update_org_stripe_connect_account_status('acct_test_001', true, true, true);
  if v_row.charges_enabled is distinct from true or v_row.payouts_enabled is distinct from true or v_row.details_submitted is distinct from true then
    raise exception 'FAIL: update_org_stripe_connect_account_status() did not persist all three flags as true (charges=%, payouts=%, details=%)',
      v_row.charges_enabled, v_row.payouts_enabled, v_row.details_submitted;
  end if;
  raise notice 'PASS: update_org_stripe_connect_account_status() (service_role, simulating account.updated) sets charges/payouts/details_submitted to true.';
end $$;

do $$
begin
  begin
    perform update_org_stripe_connect_account_status('acct_does_not_exist', true, true, true);
    raise exception 'FAIL: update_org_stripe_connect_account_status() succeeded for an unrecognized stripe_connect_account_id';
  exception
    when others then
      raise notice 'PASS: update_org_stripe_connect_account_status() raises for an unrecognized stripe_connect_account_id (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 6. upsert_org_stripe_connect_account() re-run (re-onboarding): swaps the
--        account id but must NOT reset the now-true status flags back to false ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_row org_stripe_connect_accounts;
begin
  select * into v_row from upsert_org_stripe_connect_account('20000000-0000-0000-0000-00000000000a', 'acct_test_002_reonboard');
  if v_row.stripe_connect_account_id <> 'acct_test_002_reonboard' then
    raise exception 'FAIL: upsert_org_stripe_connect_account() did not update stripe_connect_account_id on conflict (got %)', v_row.stripe_connect_account_id;
  end if;
  if v_row.charges_enabled is distinct from true or v_row.payouts_enabled is distinct from true or v_row.details_submitted is distinct from true then
    raise exception 'FAIL: re-running upsert_org_stripe_connect_account() reset an already-true status flag back to false (charges=%, payouts=%, details=%)',
      v_row.charges_enabled, v_row.payouts_enabled, v_row.details_submitted;
  end if;
  raise notice 'PASS: re-running upsert_org_stripe_connect_account() updates stripe_connect_account_id but leaves webhook-owned status flags untouched.';
end $$;

reset role;

-- === 7. tenant isolation: org B cannot see org A's Connect account row ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from org_stripe_connect_accounts where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s org_stripe_connect_accounts row';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s Connect account row.';
end $$;

reset role;

-- === 8. record_online_payment(): never granted to authenticated ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  begin
    perform record_online_payment(
      '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', '68000000-0000-0000-0000-00000000000a',
      60000, 'pi_test_001'
    );
    raise exception 'FAIL: authenticated (billing manager) was able to call record_online_payment()';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: record_online_payment() is rejected for authenticated regardless of role tier (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 9. record_online_payment(): service_role positive ===
set local role service_role;

do $$
declare
  v_payment payments;
  v_alloc_count int;
  v_alloc_total bigint;
begin
  select * into v_payment from record_online_payment(
    '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', '68000000-0000-0000-0000-00000000000a',
    60000, 'pi_test_001'
  );
  insert into _test_ids (label, id) values ('payment_online_1', v_payment.id);

  if v_payment.status <> 'recorded' or v_payment.method <> 'card' or v_payment.amount_cents <> 60000
     or v_payment.stripe_payment_intent_id <> 'pi_test_001' then
    raise exception 'FAIL: record_online_payment() did not persist the expected payment (status=%, method=%, amount_cents=%, stripe_payment_intent_id=%)',
      v_payment.status, v_payment.method, v_payment.amount_cents, v_payment.stripe_payment_intent_id;
  end if;

  select count(*), coalesce(sum(amount_cents), 0) into v_alloc_count, v_alloc_total
  from payment_allocations where payment_id = v_payment.id;
  if v_alloc_count <> 1 or v_alloc_total <> 60000 then
    raise exception 'FAIL: record_online_payment() did not create the expected allocation (count=%, total=%)', v_alloc_count, v_alloc_total;
  end if;
  raise notice 'PASS: record_online_payment() atomically creates a card payment (id=%) and its matching allocation.', v_payment.id;
end $$;

-- === 10. record_online_payment(): idempotent by stripe_payment_intent_id ===
do $$
declare
  v_original_id uuid;
  v_payment payments;
  v_payment_count int;
begin
  select id into v_original_id from _test_ids where label = 'payment_online_1';

  -- Retried delivery: same intent id, DIFFERENT amount -- must return the
  -- ORIGINAL row unchanged, not re-validate or double-insert.
  select * into v_payment from record_online_payment(
    '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', '68000000-0000-0000-0000-00000000000a',
    1, 'pi_test_001'
  );

  if v_payment.id <> v_original_id or v_payment.amount_cents <> 60000 then
    raise exception 'FAIL: record_online_payment() did not return the original row on a retried delivery (id=%, expected=%, amount_cents=%)',
      v_payment.id, v_original_id, v_payment.amount_cents;
  end if;

  select count(*) into v_payment_count from payments where stripe_payment_intent_id = 'pi_test_001';
  if v_payment_count <> 1 then
    raise exception 'FAIL: record_online_payment() double-inserted on a retried delivery (count=%)', v_payment_count;
  end if;
  raise notice 'PASS: record_online_payment() is idempotent by stripe_payment_intent_id -- a retried delivery returns the original row unchanged.';
end $$;

-- === 11. record_online_payment(): rejects exceeding the outstanding balance ===
do $$
begin
  begin
    perform record_online_payment(
      '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', '68000000-0000-0000-0000-00000000000a',
      1, 'pi_test_002_overallocate'
    );
    raise exception 'FAIL: record_online_payment() accepted a payment that would exceed the invoice''s outstanding balance';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_online_payment() rejects a payment exceeding the outstanding balance (%)', sqlerrm;
  end;
end $$;

-- === 12. record_online_payment(): rejects a non-issued (voided) invoice ===
do $$
begin
  perform void_invoice('68000000-0000-0000-0000-00000000000a', 'test void for online-payment-guard regression');
end $$;

do $$
begin
  begin
    perform record_online_payment(
      '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', '68000000-0000-0000-0000-00000000000a',
      100, 'pi_test_003_voided_invoice'
    );
    raise exception 'FAIL: record_online_payment() accepted a payment against a voided invoice';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: record_online_payment() rejects a payment against a non-issued (voided) invoice (%)', sqlerrm;
  end;
end $$;

-- === 13. record_online_payment(): rejects an empty stripe_payment_intent_id ===
do $$
begin
  begin
    perform record_online_payment(
      '20000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', '68000000-0000-0000-0000-00000000000a',
      100, ''
    );
    raise exception 'FAIL: record_online_payment() accepted an empty stripe_payment_intent_id';
  exception
    when others then
      raise notice 'PASS: record_online_payment() rejects an empty stripe_payment_intent_id (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 14. reverse_online_payment_from_webhook(): never granted to authenticated ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  begin
    perform reverse_online_payment_from_webhook('pi_test_001');
    raise exception 'FAIL: authenticated (billing manager) was able to call reverse_online_payment_from_webhook()';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: reverse_online_payment_from_webhook() is rejected for authenticated regardless of role tier (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 15. reverse_online_payment_from_webhook(): service_role positive --
--         reversed_by stays NULL (the CHECK-constraint relaxation this
--         migration makes), reversed_at is set ===
set local role service_role;

do $$
declare
  v_payment payments;
begin
  select * into v_payment from reverse_online_payment_from_webhook('pi_test_001');
  if v_payment.status <> 'reversed' or v_payment.reversed_by is not null or v_payment.reversed_at is null then
    raise exception 'FAIL: reverse_online_payment_from_webhook() did not reverse as expected (status=%, reversed_by=%, reversed_at=%)',
      v_payment.status, v_payment.reversed_by, v_payment.reversed_at;
  end if;
  raise notice 'PASS: reverse_online_payment_from_webhook() flips status to reversed with reversed_by left NULL (no PermitField actor).';
end $$;

-- === 16. reverse_online_payment_from_webhook(): idempotent on an already-reversed payment ===
do $$
declare
  v_payment payments;
begin
  select * into v_payment from reverse_online_payment_from_webhook('pi_test_001');
  if v_payment.status <> 'reversed' then
    raise exception 'FAIL: reverse_online_payment_from_webhook() on an already-reversed payment did not return it unchanged (status=%)', v_payment.status;
  end if;
  raise notice 'PASS: reverse_online_payment_from_webhook() on an already-reversed payment is a no-op, not an error (Stripe redelivery / staff-path-already-handled-it case).';
end $$;

-- === 17. reverse_online_payment_from_webhook(): raises for an unrecognized stripe_payment_intent_id ===
do $$
begin
  begin
    perform reverse_online_payment_from_webhook('pi_does_not_exist');
    raise exception 'FAIL: reverse_online_payment_from_webhook() succeeded for an unrecognized stripe_payment_intent_id';
  exception
    when others then
      raise notice 'PASS: reverse_online_payment_from_webhook() raises for an unrecognized stripe_payment_intent_id (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
