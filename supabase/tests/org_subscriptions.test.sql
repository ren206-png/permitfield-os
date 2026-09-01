-- BILLING_PROPOSAL.md §3 / 20260806000040_org_subscriptions.sql. Proves
-- three things about the new org_subscriptions table:
--   1. create_organization_with_owner() now inserts a trial subscription
--      row atomically alongside the org/owner rows (the whole point of
--      extending that RPC rather than adding a second, separate insert
--      call site).
--   2. RLS actually isolates org_subscriptions by org_id -- an org member
--      sees only their own org's row, same "assert against the real
--      `authenticated` Postgres role under RLS" discipline
--      tenant_isolation.test.sql already established (adversarial
--      self-check #4).
--   3. `authenticated` has no write path to this table at all (no INSERT/
--      UPDATE/DELETE grant, not merely an RLS policy gap) while
--      `service_role` -- the only writer, via lib/billing/subscriptions.ts's
--      webhook handler -- can write and can see across every org, same
--      "control-then-assert" shape as
--      application_documents_service_role_insert.test.sql.
--
-- Two fresh orgs are created here via the RPC itself (not seed.sql
-- fixtures) specifically so this file exercises the exact code path a real
-- signup does, and so RLS isolation can be tested between two orgs that
-- are guaranteed to each have exactly one org_subscriptions row -- seed.sql's
-- Org A/Org B fixtures insert directly into `organizations`/`org_members`
-- (bypassing the RPC, same reason every other seed fixture does), so they
-- have no org_subscriptions row to test against.
--
-- The RPC's return value (a freshly gen_random_uuid()'d org id) can't be
-- known ahead of time, so this file stashes org1_id/org2_id in a
-- transaction-local temp table rather than hardcoding a placeholder id
-- (which would silently test nothing -- an UPDATE/SELECT against an id no
-- row has still "succeeds" with zero rows affected, not a real assertion).
-- `set local role`/`set local request.jwt.claims` are only ever issued as
-- top-level statements between `do` blocks, never inside one -- same
-- structure application_documents_service_role_insert.test.sql's
-- `set role service_role;` already uses, not attempted as a PL/pgSQL
-- statement inside a block.
--
-- HOW TO RUN: see tenant_isolation.test.sql's own header for the full
-- supabase start / db reset / psql invocation, or `npm run test:sql` to run
-- every supabase/tests/*.test.sql file at once.
--
-- Whole file wrapped in begin/rollback -- GRANT is not touched here (this
-- file tests the grants 20260806000040 already put in place, it doesn't
-- change any), so a single trailing ROLLBACK is sufficient to leave no
-- residue, same as tenant_isolation.test.sql.

begin;

create temporary table _test_org_ids (label text primary key, org_id uuid not null);

-- Owned by `postgres` (the role this transaction starts as), but every `do`
-- block below that touches it runs as `authenticated` or `service_role`
-- (via the `set local role` statements further down) -- neither has an
-- implicit grant on a table it doesn't own, temp or not, so this must be
-- explicit or every insert/select against it below fails with
-- insufficient_privilege before this file's own assertions ever run.
grant select, insert on _test_org_ids to authenticated, service_role;

-- create_organization_with_owner() inserts into org_members with
-- user_id = auth.uid(), which carries a real FK to auth.users -- unlike
-- seed.sql's Org A/Org B owners (10000000...000a/000b), these two synthetic
-- users have no fixture row yet, so they're inserted here, as `postgres`
-- (this transaction's default role, before the first `set local role`
-- below), same "insert a throwaway auth.users row for a synthetic new
-- user" pattern lifecycle_intake.test.sql already established for its own
-- org-C member fixture.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-00000000001a', 'authenticated', 'authenticated',
   'org1-owner-billing@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-00000000001b', 'authenticated', 'authenticated',
   'org2-owner-billing@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

-- Step 1: create org1 as user1 (90000000...001a), via the real RPC, exactly
-- as a real signup would.
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-00000000001a","role":"authenticated"}';

do $$
declare
  new_org_id uuid;
begin
  select create_organization_with_owner('Test Org 1 -- Billing') into new_org_id;
  insert into _test_org_ids (label, org_id) values ('org1', new_org_id);
end $$;

-- Step 2: create org2 as a different user (90000000...001b), same way.
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-00000000001b","role":"authenticated"}';

do $$
declare
  new_org_id uuid;
begin
  select create_organization_with_owner('Test Org 2 -- Billing') into new_org_id;
  insert into _test_org_ids (label, org_id) values ('org2', new_org_id);
end $$;

reset role;

-- Step 3 (assert, atomicity): org1's subscription row exists with the
-- expected trial defaults, with no separate insert call anywhere in this
-- test -- create_organization_with_owner() did it.
do $$
declare
  v_org1_id uuid;
  v_tier org_subscription_tier;
  v_status org_subscription_status;
  v_trial_ends_at timestamptz;
  v_stripe_customer_id text;
begin
  select org_id into v_org1_id from _test_org_ids where label = 'org1';

  select tier, status, trial_ends_at, stripe_customer_id
    into v_tier, v_status, v_trial_ends_at, v_stripe_customer_id
    from org_subscriptions where org_id = v_org1_id;

  if v_tier is distinct from 'pro' or v_status is distinct from 'trialing' or v_stripe_customer_id is not null then
    raise exception 'FAIL (atomicity): org1''s org_subscriptions row has unexpected defaults (tier=%, status=%, stripe_customer_id=%)',
      v_tier, v_status, v_stripe_customer_id;
  end if;
  if v_trial_ends_at < now() + interval '13 days' or v_trial_ends_at > now() + interval '15 days' then
    raise exception 'FAIL (atomicity): org1''s trial_ends_at is not ~14 days out (got %)', v_trial_ends_at;
  end if;
  raise notice 'PASS (atomicity): create_organization_with_owner() inserted a trial org_subscriptions row (tier=%, status=%, trial_ends_at=%)',
    v_tier, v_status, v_trial_ends_at;
end $$;

-- Step 4/5 (RLS positive + negative): user1 (org1's owner) sees org1's own
-- row and cannot see org2's.
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-00000000001a","role":"authenticated"}';

do $$
declare
  v_org1_id uuid;
  v_org2_id uuid;
  v_count int;
begin
  select org_id into v_org1_id from _test_org_ids where label = 'org1';
  select org_id into v_org2_id from _test_org_ids where label = 'org2';

  select count(*) into v_count from org_subscriptions where org_id = v_org1_id;
  if v_count <> 1 then
    raise exception 'FAIL (RLS positive): org1 owner should see exactly 1 row for their own org, saw %', v_count;
  end if;
  raise notice 'PASS (RLS positive): org1 owner sees their own org_subscriptions row';

  select count(*) into v_count from org_subscriptions where org_id = v_org2_id;
  if v_count <> 0 then
    raise exception 'FAIL (RLS negative): org1 owner could read org2''s org_subscriptions row';
  end if;
  raise notice 'PASS (RLS negative): org1 owner cannot read org2''s org_subscriptions row';
end $$;

-- Step 6 (write boundary, INSERT): `authenticated` has no INSERT grant at
-- all on org_subscriptions -- this must fail at the privilege layer
-- (insufficient_privilege), not merely be filtered by RLS. Privilege checks
-- in Postgres run before constraint/RLS evaluation, so this proves the
-- grant boundary regardless of which org_id is targeted.
do $$
begin
  insert into org_subscriptions (org_id, tier, status)
  values ((select org_id from _test_org_ids where label = 'org1'), 'starter', 'active');
  raise exception 'FAIL: authenticated INSERT into org_subscriptions succeeded -- this table must be service_role-write-only';
exception
  when insufficient_privilege then
    raise notice 'PASS: authenticated INSERT into org_subscriptions correctly rejected (permission denied). (%)', sqlerrm;
end $$;

-- Step 7 (write boundary, UPDATE): same -- no UPDATE grant to `authenticated`.
do $$
begin
  update org_subscriptions set tier = 'starter' where org_id = (select org_id from _test_org_ids where label = 'org1');
  raise exception 'FAIL: authenticated UPDATE of org_subscriptions succeeded -- this table must be service_role-write-only';
exception
  when insufficient_privilege then
    raise notice 'PASS: authenticated UPDATE of org_subscriptions correctly rejected (permission denied). (%)', sqlerrm;
end $$;

reset role;

-- Step 8 (service_role, assert write + cross-org visibility): the webhook
-- handler's actual write shape -- an UPDATE by org_id, same as
-- lib/billing/subscriptions.ts's upsertOrgSubscription() -- succeeds, and
-- service_role (RLS-bypassing) can see rows across both orgs at once,
-- exactly as a cross-tenant mirror-writer needs to.
set local role service_role;

do $$
declare
  v_org1_id uuid;
  v_tier org_subscription_tier;
  v_count int;
begin
  select org_id into v_org1_id from _test_org_ids where label = 'org1';

  update org_subscriptions
  set stripe_customer_id = 'cus_test123', stripe_subscription_id = 'sub_test123', tier = 'starter', status = 'active', updated_at = now()
  where org_id = v_org1_id;

  select tier into v_tier from org_subscriptions where org_id = v_org1_id;
  if v_tier is distinct from 'starter' then
    raise exception 'FAIL: service_role UPDATE of org_subscriptions did not persist (tier=%)', v_tier;
  end if;
  raise notice 'PASS: service_role UPDATE of org_subscriptions succeeds (tier=%)', v_tier;

  select count(*) into v_count from org_subscriptions
  where org_id in (select org_id from _test_org_ids);
  if v_count <> 2 then
    raise exception 'FAIL: service_role should see both orgs'' rows (RLS-bypassing), saw %', v_count;
  end if;
  raise notice 'PASS: service_role sees both orgs'' org_subscriptions rows (count=%)', v_count;
end $$;

reset role;

rollback;
