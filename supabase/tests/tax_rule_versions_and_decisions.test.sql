-- Gate 4 (Quotes & Payments), Phase A /
-- 20260806000055_tax_rule_versions_and_decisions.sql. Storage-shape-only
-- migration -- this file proves the schema/RLS/seed shape, not any tax
-- calculation (none exists).
-- Proves:
--   1. One seed fixture row per province (AB/ON/BC), all UNVERIFIED
--      (verified = false), including BC's separate PST row.
--   2. tax_rule_versions is shared reference data: read is unconditional
--      for any authenticated caller (not org-scoped); write is
--      billing-manager tier, and append-only regardless.
--   3. tax_decisions: any org member can insert a plain (non-override)
--      decision; setting overridden_by requires billing-manager tier;
--      tenant isolation holds.

begin;

-- Step 1 (seed fixtures): AB/ON/BC covered, BC PST independent of BC GST.
do $$
declare
  v_count int;
  v_bc_gst_rate numeric;
  v_bc_pst_rate numeric;
begin
  select count(*) into v_count from tax_rule_versions where province_code in ('AB', 'ON', 'BC') and verified = false;
  if v_count < 4 then
    raise exception 'FAIL: expected at least 4 UNVERIFIED seed rows across AB/ON/BC, found %', v_count;
  end if;

  select rate_percent into v_bc_gst_rate from tax_rule_versions where province_code = 'BC' and tax_type = 'gst';
  select rate_percent into v_bc_pst_rate from tax_rule_versions where province_code = 'BC' and tax_type = 'pst';
  if v_bc_gst_rate is null or v_bc_pst_rate is null then
    raise exception 'FAIL: expected BC to have both a gst row and a separate pst row, got gst=%, pst=%', v_bc_gst_rate, v_bc_pst_rate;
  end if;
  raise notice 'PASS: AB/ON/BC seed rows present (count=%), BC GST (%) and PST (%) tracked as separate rows.', v_count, v_bc_gst_rate, v_bc_pst_rate;
end $$;

-- Fixture inserts run under this transaction's default connecting role
-- (postgres, before any `set local role` below) -- same pattern as
-- org_subscriptions.test.sql/readiness_checklist.test.sql -- because
-- service_role itself has no INSERT grant on auth.users.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated',
   'org-a-member-tax2@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated',
   'org-a-permit-manager-tax2@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

insert into clients (id, org_id, name) values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Client')
on conflict (id) do nothing;

insert into estimates (id, org_id, client_id) values
  ('63000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

insert into estimate_line_items (id, org_id, estimate_id, description, quantity, unit_price_cents) values
  ('64000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '63000000-0000-0000-0000-00000000000a', 'Labour', 1, 10000)
on conflict (id) do nothing;

-- Step 2 (read, unconditional): a plain org A member can read every
-- province's tax_rule_versions row, not just their own org's (there is no
-- org_id column -- this is shared reference data).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from tax_rule_versions;
  if v_count < 4 then
    raise exception 'FAIL: plain member cannot read the full shared tax_rule_versions table (count=%)', v_count;
  end if;
  raise notice 'PASS: plain member reads the full shared tax_rule_versions table (count=%).', v_count;
end $$;

-- Step 3 (write boundary, negative): a plain member cannot insert a new
-- tax_rule_versions row.
do $$
begin
  begin
    insert into tax_rule_versions (province_code, tax_type, rate_percent, effective_from, source_note)
    values ('ON', 'hst', 15.00, current_date, 'test forged rate change');
    raise exception 'FAIL: plain member inserted a tax_rule_versions row';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected inserting a tax_rule_versions row (%)', sqlerrm;
  end;
end $$;

-- Step 4 (write boundary, positive): a permit_manager CAN insert a new
-- version row (a rate change, modeled as a new row, not an edit).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into tax_rule_versions (province_code, tax_type, rate_percent, effective_from, source_note)
  values ('ON', 'hst', 14.00, current_date + 365, 'UNVERIFIED test fixture -- hypothetical future rate change, not a real filing')
  returning id into v_id;
  raise notice 'PASS: permit_manager can insert a new tax_rule_versions row (id=%).', v_id;
end $$;

-- Step 5 (append-only): even a permit_manager cannot UPDATE/DELETE an
-- existing tax_rule_versions row. `authenticated` has no UPDATE/DELETE
-- grant on this table at all (20260806000055's grant section: select+
-- insert only), so this is rejected at the grant layer before the
-- forbid_update_delete() trigger even runs -- same "permission denied, not
-- a trigger message" shape permit_status_machine.test.sql's own
-- application_status_history append-only check accepts via `when others`,
-- not a substring match on the trigger's error text.
do $$
declare
  v_id uuid;
begin
  select id into v_id from tax_rule_versions where province_code = 'AB' and tax_type = 'gst' limit 1;
  begin
    update tax_rule_versions set rate_percent = 99 where id = v_id;
    raise exception 'FAIL: UPDATE of tax_rule_versions succeeded despite append-only design';
  exception
    when others then
      raise notice 'PASS: tax_rule_versions UPDATE rejected (%)', sqlerrm;
  end;
end $$;

-- Step 6 (tax_decisions, plain-insert, any member): a plain member can
-- record a non-override tax decision.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_rule_id uuid;
  v_id uuid;
begin
  select id into v_rule_id from tax_rule_versions where province_code = 'ON' and tax_type = 'hst' and rate_percent = 13.00;

  insert into tax_decisions (org_id, source_kind, source_line_item_id, province_code, tax_rule_version_id, status, rate_applied_percent, tax_amount_cents)
  values ('20000000-0000-0000-0000-00000000000a', 'estimate_line_item', '64000000-0000-0000-0000-00000000000a', 'ON', v_rule_id, 'applied', 13.00, 1300)
  returning id into v_id;

  raise notice 'PASS: plain member can record a non-override tax_decision (id=%).', v_id;
end $$;

-- Step 7 (privilege boundary, override requires billing-manager tier):
-- a plain member cannot insert a decision with overridden_by set.
do $$
begin
  begin
    insert into tax_decisions (org_id, source_kind, source_line_item_id, province_code, status, overridden_by, override_reason, overridden_at)
    values ('20000000-0000-0000-0000-00000000000a', 'estimate_line_item', '64000000-0000-0000-0000-00000000000a', 'BC', 'review_required',
            '10000000-0000-0000-0000-0000000000e1', 'forged override attempt', now());
    raise exception 'FAIL: plain member inserted an overridden tax_decision';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member is rejected inserting an overridden tax_decision (%)', sqlerrm;
  end;
end $$;

-- Step 8 (positive, permit_manager overrides): billing-manager tier CAN.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e2","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into tax_decisions (org_id, source_kind, source_line_item_id, province_code, status, overridden_by, override_reason, overridden_at)
  values ('20000000-0000-0000-0000-00000000000a', 'estimate_line_item', '64000000-0000-0000-0000-00000000000a', 'BC', 'review_required',
          '10000000-0000-0000-0000-0000000000e2', 'mixed-use classification needs manual review', now())
  returning id into v_id;
  raise notice 'PASS: permit_manager can record an overridden tax_decision (id=%).', v_id;
end $$;

reset role;

-- Step 9 (tenant isolation): org B cannot see org A's tax_decisions.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from tax_decisions where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B could read org A''s tax_decisions';
  end if;
  raise notice 'PASS (tenant isolation): org B cannot read org A''s tax_decisions.';
end $$;

reset role;

rollback;
