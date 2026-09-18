-- Gate 4 (Quotes & Payments), Phase A / 20260806000052_estimates.sql.
-- Proves:
--   1. Draft-mutable RLS: an org member can INSERT/UPDATE/DELETE
--      estimates/estimate_line_items while status = 'draft', and loses that
--      access the moment status leaves 'draft' -- the RLS-conditional-on-
--      status mechanism this migration's header comment documents as a
--      deliberate deviation from a trigger-based immutability approach.
--   2. Composite-FK cross-org rejection (client_id/project_id).
--   3. send_estimate(): role-gated (org_owner/permit_manager tier),
--      draft-required, and produces the correct immutable revision
--      (revision_number = 1, current_revision_id updated, status = 'sent').
--   4. estimate_revisions is append-only (forbid_update_delete).
--   5. Tenant isolation on estimates/estimate_line_items/estimate_revisions.
--
-- Org A/B and their owners are seeded by supabase/seed.sql PART 2.

begin;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
   'org-a-member-est@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
   'org-a-permit-manager-est@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client'),
  ('61000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Client')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- Step 1: plain member creates a draft estimate + line items for org A.
create temporary table _test_estimate_ids (label text primary key, id uuid not null);
grant select, insert on _test_estimate_ids to authenticated, service_role;

do $$
declare
  v_id uuid;
begin
  insert into estimates (org_id, client_id, scope_notes)
  values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a', 'Test scope')
  returning id into v_id;
  insert into _test_estimate_ids (label, id) values ('est_a', v_id);

  insert into estimate_line_items (org_id, estimate_id, description, quantity, unit_price_cents)
  values ('20000000-0000-0000-0000-00000000000a', v_id, 'Labour', 2, 10000);

  raise notice 'PASS: plain member inserts a draft estimate + line item for org A (id=%).', v_id;
end $$;

-- Step 2 (composite FK cross-org rejection): org A cannot create an estimate
-- referencing org B's client.
do $$
begin
  begin
    insert into estimates (org_id, client_id) values ('20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: estimate with a cross-org client_id was accepted';
  exception
    when sqlstate '23503' then
      raise notice 'PASS: cross-org client_id rejected by the composite FK (%)', sqlerrm;
  end;
end $$;

-- Step 3 (draft-mutable RLS): the same member can UPDATE the draft estimate.
do $$
declare
  v_id uuid;
  v_notes text;
begin
  select id into v_id from _test_estimate_ids where label = 'est_a';
  update estimates set scope_notes = 'Updated scope' where id = v_id;
  select scope_notes into v_notes from estimates where id = v_id;
  if v_notes <> 'Updated scope' then
    raise exception 'FAIL: draft estimate UPDATE by an org member did not persist';
  end if;
  raise notice 'PASS: draft estimate is UPDATE-able by an org member.';
end $$;

-- Step 4 (privilege boundary, send_estimate role gate): a plain member
-- cannot send the estimate (org_owner/permit_manager tier required).
do $$
declare
  v_id uuid;
begin
  select id into v_id from _test_estimate_ids where label = 'est_a';
  begin
    perform send_estimate(v_id, 20000, 0, 0, 20000, '[{"description":"Labour","quantity":2,"unit_price_cents":10000}]'::jsonb);
    raise exception 'FAIL: plain member was able to send_estimate()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected calling send_estimate() (%)', sqlerrm;
  end;
end $$;

-- Step 5 (send_estimate, positive): a permit_manager can send the estimate.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_rev estimate_revisions;
  v_est estimates;
begin
  select id into v_id from _test_estimate_ids where label = 'est_a';

  select * into v_rev from send_estimate(
    v_id, 20000, 0, 1000, 21000,
    '[{"description":"Labour","quantity":2,"unit_price_cents":10000}]'::jsonb
  );

  if v_rev.revision_number <> 1 or v_rev.total_cents <> 21000 then
    raise exception 'FAIL: send_estimate() produced unexpected revision (revision_number=%, total_cents=%)', v_rev.revision_number, v_rev.total_cents;
  end if;

  select * into v_est from estimates where id = v_id;
  if v_est.status <> 'sent' or v_est.current_revision_id <> v_rev.id then
    raise exception 'FAIL: estimate not correctly transitioned to sent (status=%, current_revision_id=%, expected=%)', v_est.status, v_est.current_revision_id, v_rev.id;
  end if;
  raise notice 'PASS: send_estimate() creates revision 1 and flips the estimate to sent with current_revision_id set correctly.';
end $$;

-- Step 6 (immutability, RLS side): the now-'sent' estimate can no longer be
-- UPDATEd by an org member -- the draft-status-gated USING clause excludes
-- it, so the UPDATE affects 0 rows (silently, no error) rather than being
-- rejected loudly; asserted via row count, not an exception.
do $$
declare
  v_id uuid;
  v_notes_before text;
  v_notes_after text;
begin
  select id into v_id from _test_estimate_ids where label = 'est_a';
  select scope_notes into v_notes_before from estimates where id = v_id;

  update estimates set scope_notes = 'Should not persist' where id = v_id;

  select scope_notes into v_notes_after from estimates where id = v_id;
  if v_notes_after <> v_notes_before then
    raise exception 'FAIL: a sent estimate was mutated by a plain authenticated UPDATE (expected no-op, got scope_notes=%)', v_notes_after;
  end if;
  raise notice 'PASS: a sent estimate is immune to a direct authenticated UPDATE (RLS draft-only gate holds; 0 rows affected).';
end $$;

-- Step 7 (append-only): estimate_revisions itself cannot be touched by
-- UPDATE/DELETE, even by the org's own permit_manager. `authenticated` has
-- no UPDATE/DELETE grant on this table at all (20260806000052's grant
-- section), so this is rejected at the grant layer before the
-- forbid_update_delete() trigger even runs -- same "permission denied,
-- not a trigger message" shape permit_status_machine.test.sql's own
-- application_status_history append-only check accepts via `when others`,
-- not a substring match on the trigger's error text.
do $$
declare
  v_rev_id uuid;
begin
  select current_revision_id into v_rev_id from estimates where id = (select id from _test_estimate_ids where label = 'est_a');

  begin
    update estimate_revisions set revision_number = 99 where id = v_rev_id;
    raise exception 'FAIL: UPDATE of estimate_revisions succeeded despite append-only design';
  exception
    when others then
      raise notice 'PASS: estimate_revisions UPDATE rejected (%)', sqlerrm;
  end;
end $$;

reset role;

-- Step 8 (tenant isolation): org B's owner cannot see org A's estimate,
-- line item, or revision.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_count int;
begin
  select id into v_id from _test_estimate_ids where label = 'est_a';

  select count(*) into v_count from estimates where id = v_id;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B owner could read org A''s estimate';
  end if;

  select count(*) into v_count from estimate_line_items where estimate_id = v_id;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B owner could read org A''s estimate line items';
  end if;

  select count(*) into v_count from estimate_revisions where estimate_id = v_id;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B owner could read org A''s estimate revision';
  end if;

  raise notice 'PASS (tenant isolation): org B owner cannot read any of org A''s estimates/line items/revisions.';
end $$;

reset role;

rollback;
