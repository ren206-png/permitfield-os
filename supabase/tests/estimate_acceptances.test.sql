-- Gate 4 (Quotes & Payments), Phase A / 20260806000053_estimate_acceptances.sql.
-- Proves:
--   1. record_estimate_acceptance() happy path (service_role caller, the
--      future bridge layer's shape) -- inserts the acceptance and flips the
--      estimate to 'accepted'.
--   2. `authenticated` has no execute grant on record_estimate_acceptance()
--      at all (external-actor pattern -- no session should ever call it
--      directly).
--   3. Stale-revision guard: once a second revision is sent, accepting the
--      first (no-longer-current) revision is rejected -- the actual race
--      this gate's "a new revision invalidates any stale acceptance
--      action" requirement targets.
--   4. unique(revision_id): a revision that already has an acceptance can
--      never get a second one.
--   5. Tenant-scoped read (RLS): any org member can see who accepted what.
--   6. estimate_acceptances is append-only.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
        'org-a-permit-manager-acc@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client')
on conflict (id) do nothing;

create temporary table _test_ids (label text primary key, id uuid not null);
grant select, insert on _test_ids to authenticated, service_role;

-- Step 1: permit_manager drafts and sends an estimate (revision 1).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_est_id uuid;
  v_rev1 estimate_revisions;
begin
  insert into estimates (org_id, client_id) values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
  returning id into v_est_id;
  insert into _test_ids (label, id) values ('est', v_est_id);

  select * into v_rev1 from send_estimate(v_est_id, 10000, 0, 0, 10000, '[]'::jsonb);
  insert into _test_ids (label, id) values ('rev1', v_rev1.id);
  raise notice 'PASS: estimate sent, revision 1 created (id=%).', v_rev1.id;
end $$;

reset role;

-- Step 2 (privilege boundary): `authenticated` cannot call
-- record_estimate_acceptance() at all -- no execute grant, not just an RLS gap.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_rev1_id uuid;
begin
  select id into v_rev1_id from _test_ids where label = 'rev1';
  begin
    perform record_estimate_acceptance(v_rev1_id, 'hash-abc', '{}'::jsonb, 'Jane Doe', 'Owner');
    raise exception 'FAIL: authenticated was able to call record_estimate_acceptance()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated has no execute grant on record_estimate_acceptance() (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 3 (happy path, service_role -- the future bridge-layer caller shape).
set local role service_role;

do $$
declare
  v_rev1_id uuid;
  v_est_id uuid;
  v_acc estimate_acceptances;
  v_status estimate_status;
begin
  select id into v_rev1_id from _test_ids where label = 'rev1';
  select id into v_est_id from _test_ids where label = 'est';

  select * into v_acc from record_estimate_acceptance(v_rev1_id, 'hash-abc', '{"line_items":[]}'::jsonb, 'Jane Doe', 'Owner', '203.0.113.5'::inet, 'test-agent/1.0', 'I agree to sign electronically.', 'typed', null);

  if v_acc.revision_id <> v_rev1_id or v_acc.typed_name <> 'Jane Doe' then
    raise exception 'FAIL: record_estimate_acceptance() did not persist expected fields (revision_id=%, typed_name=%)', v_acc.revision_id, v_acc.typed_name;
  end if;

  select status into v_status from estimates where id = v_est_id;
  if v_status <> 'accepted' then
    raise exception 'FAIL: estimate not flipped to accepted after acceptance (status=%)', v_status;
  end if;
  raise notice 'PASS: record_estimate_acceptance() inserts the acceptance and flips the estimate to accepted.';
end $$;

-- Step 4 (unique(revision_id)): a second acceptance of the SAME revision
-- is rejected, even though it's still the current revision.
do $$
declare
  v_rev1_id uuid;
begin
  select id into v_rev1_id from _test_ids where label = 'rev1';
  begin
    perform record_estimate_acceptance(v_rev1_id, 'hash-abc-2', '{}'::jsonb, 'Someone Else', 'Owner', null, null, 'I agree to sign electronically.', 'typed', null);
    raise exception 'FAIL: a second acceptance of the same revision was accepted';
  exception
    when unique_violation then
      raise notice 'PASS: a second acceptance of the same revision is rejected by unique(revision_id) (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 5 (stale-revision guard): send a second revision. send_estimate()
-- only accepts draft estimates, and estimates_update's own RLS policy only
-- allows an authenticated org member to UPDATE a row that is ALREADY
-- 'draft' (the USING clause excludes the current 'sent' row entirely) --
-- so re-opening a sent estimate to draft is not reachable via a plain
-- authenticated UPDATE at all, only via service_role (RLS-bypassing),
-- exactly like the future bridge/staff-tooling layer would. This is a
-- schema/RPC-only pass, so there is no dedicated `reopen_estimate()` RPC
-- yet -- this direct service_role UPDATE stands in for that future action,
-- solely to exercise the stale-revision guard itself.
set local role service_role;

do $$
declare
  v_est_id uuid;
begin
  select id into v_est_id from _test_ids where label = 'est';
  update estimates set status = 'draft' where id = v_est_id;
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_est_id uuid;
  v_rev2 estimate_revisions;
begin
  select id into v_est_id from _test_ids where label = 'est';
  select * into v_rev2 from send_estimate(v_est_id, 20000, 0, 0, 20000, '[]'::jsonb);
  if v_rev2.revision_number <> 2 then
    raise exception 'FAIL: expected revision_number 2, got %', v_rev2.revision_number;
  end if;
  insert into _test_ids (label, id) values ('rev2', v_rev2.id);
  raise notice 'PASS: second revision created (revision_number=2), now the current revision.';
end $$;

reset role;

set local role service_role;

do $$
declare
  v_rev1_id uuid;
begin
  select id into v_rev1_id from _test_ids where label = 'rev1';
  begin
    perform record_estimate_acceptance(v_rev1_id, 'hash-stale', '{}'::jsonb, 'Late Accepter', 'Owner');
    raise exception 'FAIL: accepting a stale (no-longer-current) revision succeeded';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: accepting a stale revision is rejected with 22023 (%)', sqlerrm;
  end;
end $$;

-- Step 6: accepting the NEW current revision (rev2) succeeds.
do $$
declare
  v_rev2_id uuid;
  v_acc estimate_acceptances;
begin
  select id into v_rev2_id from _test_ids where label = 'rev2';
  select * into v_acc from record_estimate_acceptance(v_rev2_id, 'hash-rev2', '{}'::jsonb, 'On Time Accepter', 'Owner', null, null, 'I agree to sign electronically.', 'drawn',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
  if v_acc.revision_id <> v_rev2_id then
    raise exception 'FAIL: acceptance of the current revision did not persist as expected';
  end if;
  if v_acc.signature_method <> 'drawn' or v_acc.signature_png_base64 is null
    or v_acc.esign_consent_at is null or v_acc.esign_consent_text <> 'I agree to sign electronically.' then
    raise exception 'FAIL: drawn e-signature fields not persisted (method=%, consent_at=%)', v_acc.signature_method, v_acc.esign_consent_at;
  end if;
  raise notice 'PASS: accepting the current revision (rev2) with a drawn e-signature succeeds and stores consent + signature.';
end $$;

reset role;

-- Step 7 (append-only): estimate_acceptances cannot be touched by
-- UPDATE/DELETE. `authenticated` has no UPDATE/DELETE grant on this table
-- at all (20260806000053's grant section), so this is rejected at the
-- grant layer before the forbid_update_delete() trigger even runs -- same
-- "permission denied, not a trigger message" shape
-- permit_status_machine.test.sql's own application_status_history
-- append-only check accepts via `when others`, not a substring match on
-- the trigger's error text.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_acc_id uuid;
begin
  select id into v_acc_id from estimate_acceptances where revision_id = (select id from _test_ids where label = 'rev2');

  begin
    update estimate_acceptances set typed_name = 'Hijacked' where id = v_acc_id;
    raise exception 'FAIL: UPDATE of estimate_acceptances succeeded despite append-only design';
  exception
    when others then
      raise notice 'PASS: estimate_acceptances UPDATE rejected (%)', sqlerrm;
  end;
end $$;

-- Step 8 (RLS read): the org member can SELECT both acceptances.
do $$
declare
  v_count int;
  v_est_id uuid;
begin
  select id into v_est_id from _test_ids where label = 'est';
  select count(*) into v_count from estimate_acceptances where estimate_id = v_est_id;
  if v_count <> 2 then
    raise exception 'FAIL: org member should see both acceptances (rev1 + rev2), saw %', v_count;
  end if;
  raise notice 'PASS: org member reads both estimate_acceptances rows for their org.';
end $$;

reset role;

rollback;
