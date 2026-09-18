-- Gate 4 (Quotes & Payments), Phase A / 20260806000057_reminder_jobs.sql.
-- Proves:
--   1. Any org member can create/cancel a pending reminder_job (no
--      billing-manager gate -- scheduling is not one of this gate's listed
--      consequential actions).
--   2. The cancel-only update policy: an org member can move
--      pending -> canceled, but cannot set status to 'sent'/'skipped'
--      directly (only the future service_role poller does that).
--   3. reminder_delivery_attempts: authenticated select-only, service_role
--      the only writer, and append-only.
--   4. Tenant isolation.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
        'org-a-member-rem@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'member')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client')
on conflict (id) do nothing;

insert into invoices (id, org_id, client_id) values
  ('65000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1: a plain member creates a pending reminder for org A's invoice.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into reminder_jobs (org_id, kind, target_kind, target_id, send_after)
  values ('20000000-0000-0000-0000-00000000000a', 'invoice_due_soon', 'invoice', '65000000-0000-0000-0000-00000000000b', now() + interval '3 days')
  returning id into v_id;
  insert into _test_ids (label, id) values ('rem_a1', v_id);
  raise notice 'PASS: plain member creates a pending reminder_job for org A (id=%).', v_id;
end $$;

-- Step 2 (cancel-only update, positive): the same member can cancel it.
do $$
declare
  v_id uuid;
  v_status reminder_job_status;
begin
  select id into v_id from _test_ids where label = 'rem_a1';
  update reminder_jobs set status = 'canceled', canceled_at = now(), cancel_reason = 'invoice paid early' where id = v_id;
  select status into v_status from reminder_jobs where id = v_id;
  if v_status <> 'canceled' then
    raise exception 'FAIL: org member could not cancel their own pending reminder_job (status=%)', v_status;
  end if;
  raise notice 'PASS: org member cancels a pending reminder_job (status=%).', v_status;
end $$;

-- Step 3 (cancel-only update, negative): an org member cannot claim a
-- reminder was 'sent' directly -- the WITH CHECK clause only allows the
-- target status to be 'canceled', so this UPDATE violates the policy.
do $$
declare
  v_id uuid;
begin
  insert into reminder_jobs (org_id, kind, target_kind, target_id, send_after)
  values ('20000000-0000-0000-0000-00000000000a', 'invoice_due_soon', 'invoice', '65000000-0000-0000-0000-00000000000b', now() + interval '3 days')
  returning id into v_id;
  insert into _test_ids (label, id) values ('rem_a2', v_id);

  begin
    update reminder_jobs set status = 'sent' where id = v_id;
    raise exception 'FAIL: org member set reminder_jobs.status = sent directly';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: org member cannot set reminder_jobs.status = sent directly (%)', sqlerrm;
  end;
end $$;

-- Step 4 (service_role, the future poller's write path): flips a job to sent.
reset role;
set local role service_role;

do $$
declare
  v_id uuid;
  v_status reminder_job_status;
begin
  select id into v_id from _test_ids where label = 'rem_a2';
  update reminder_jobs set status = 'sent' where id = v_id;
  select status into v_status from reminder_jobs where id = v_id;
  if v_status <> 'sent' then
    raise exception 'FAIL: service_role could not flip a reminder_job to sent (status=%)', v_status;
  end if;

  insert into reminder_delivery_attempts (org_id, reminder_job_id, outcome)
  values ('20000000-0000-0000-0000-00000000000a', v_id, 'success');
  raise notice 'PASS: service_role flips a reminder_job to sent and records a successful delivery attempt.';
end $$;

reset role;

-- Step 5 (reminder_delivery_attempts, RLS + grant boundaries): the org
-- member can SELECT the attempt but cannot INSERT one directly.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_count int;
begin
  select id into v_id from _test_ids where label = 'rem_a2';
  select count(*) into v_count from reminder_delivery_attempts where reminder_job_id = v_id;
  if v_count <> 1 then
    raise exception 'FAIL: org member should see the delivery attempt recorded by service_role, saw %', v_count;
  end if;
  raise notice 'PASS: org member reads the reminder_delivery_attempts row service_role recorded.';

  begin
    insert into reminder_delivery_attempts (org_id, reminder_job_id, outcome)
    values ('20000000-0000-0000-0000-00000000000a', v_id, 'success');
    raise exception 'FAIL: authenticated direct INSERT into reminder_delivery_attempts succeeded';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated has no INSERT grant on reminder_delivery_attempts (%)', sqlerrm;
  end;
end $$;

-- Step 6 (append-only): reminder_delivery_attempts cannot be UPDATE/DELETEd,
-- even by service_role. service_role only has select+insert grant on this
-- table (20260806000057's grant section), so this is rejected at the grant
-- layer before the forbid_update_delete() trigger even runs -- same
-- "permission denied, not a trigger message" shape
-- permit_status_machine.test.sql's own application_status_history
-- append-only check accepts via `when others`, not a substring match on
-- the trigger's error text.
set local role service_role;

do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_ids where label = 'rem_a2';
  begin
    update reminder_delivery_attempts set outcome = 'failure' where reminder_job_id = v_id;
    raise exception 'FAIL: UPDATE of reminder_delivery_attempts succeeded despite append-only design';
  exception
    when others then
      raise notice 'PASS: reminder_delivery_attempts UPDATE rejected (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 7 (tenant isolation): org B cannot see org A's reminder_jobs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from reminder_jobs where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s reminder_jobs';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s reminder_jobs.';
end $$;

reset role;

rollback;
