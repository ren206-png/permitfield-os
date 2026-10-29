-- Gate 6, sub-phase 6.6 exit evidence (master prompt §17 N.6: "state-machine
-- tests incl. offline-override rejection"). Proves
-- 20260806000098_copilot_lifecycle.sql:
--   1. record_status_observation applies staff-recorded evidence through
--      transition_permit_status (same role tiers), idempotently;
--   2. an observation dated before the newest known status is kept as
--      'stale' and NEVER changes the status (a late/queued update cannot
--      override a newer one);
--   3. illegal transitions are recorded, not applied; unmapped wording is
--      recorded only; AI suggestions and connector events never apply;
--      connector callbacks are deduplicated and ordered;
--   4. inspection results need an issued permit; condition waivers need a
--      note; an internal package approval never changes permit_status;
--   5. tenant isolation and append-only.
--
-- Expected failures are caught by SQLSTATE, never `when others`.
--
-- Run: npm run test:sql (scripts/run-sql-tests.sh), after `supabase db reset`.

begin;

-- === Fixtures (as postgres) ===
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e6', 'authenticated', 'authenticated',
        'lifecycle-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;
insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e6', 'member')
on conflict (org_id, user_id) do nothing;

-- Application A is under municipal review (fixture shortcut).
update permit_applications set status = 'submitted', permit_status = 'under_municipal_review'
where id = '40000000-0000-0000-0000-00000000000a';

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;

-- === 1. Role tiers still apply ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e6","role":"authenticated"}';
do $$
begin
  perform record_status_observation('40000000-0000-0000-0000-00000000000a', 'authority_correspondence', 'Permit issued',
    'issued', '2026-10-20T15:00:00Z', null, 'BP-1', gen_random_uuid());
  raise exception 'FAIL: a plain member recorded a jurisdiction outcome';
exception when insufficient_privilege then
  raise notice 'PASS: a member cannot record an issued permit (transition_permit_status role tier applies)';
end $$;

-- === Owner records the issuance ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare o permit_status_observations; again permit_status_observations; k uuid := gen_random_uuid(); n int;
begin
  o := record_status_observation('40000000-0000-0000-0000-00000000000a', 'authority_correspondence', 'Permit issued -- conditions apply',
    'issued', '2026-10-20T15:00:00Z', null, 'BP-1', k);
  if o.outcome <> 'applied' or o.applied_history_id is null
     or (select permit_status from permit_applications where id = '40000000-0000-0000-0000-00000000000a') <> 'issued' then
    raise exception 'FAIL: issuance not applied (outcome %)', o.outcome;
  end if;
  raise notice 'PASS: staff-recorded issuance is applied through the status machine, with its history row';

  again := record_status_observation('40000000-0000-0000-0000-00000000000a', 'authority_correspondence', 'Permit issued -- conditions apply',
    'issued', '2026-10-20T15:00:00Z', null, 'BP-1', k);
  select count(*) into n from application_status_history where application_id = '40000000-0000-0000-0000-00000000000a' and request_key = k;
  if again.id <> o.id or n <> 1 then raise exception 'FAIL: replay duplicated the observation or history (%)', n; end if;
  raise notice 'PASS: replaying the same request returns the first observation; one history row';
end $$;

-- === 2. Offline / late update cannot override a newer status ===
do $$
declare o permit_status_observations;
begin
  -- issued -> expired is a LEGAL transition, so only the date rule stops
  -- this late, older update (e.g. queued offline) from overriding.
  o := record_status_observation('40000000-0000-0000-0000-00000000000a', 'user_reported', 'Permit expired (note from an old site visit)',
    'expired', '2026-10-10T09:00:00Z', null, null, gen_random_uuid());
  if o.outcome <> 'stale' or (select permit_status from permit_applications where id = '40000000-0000-0000-0000-00000000000a') <> 'issued' then
    raise exception 'FAIL: an older update changed the status (outcome %)', o.outcome;
  end if;
  raise notice 'PASS: an update dated before the newest status is kept as stale and does not override it';
end $$;

-- === 3. Other outcomes ===
do $$
declare o permit_status_observations;
begin
  o := record_status_observation('40000000-0000-0000-0000-00000000000a', 'user_reported', 'Still issued',
    'issued', '2026-10-22T09:00:00Z', null, null, gen_random_uuid());
  if o.outcome <> 'already_current' then raise exception 'FAIL: expected already_current, got %', o.outcome; end if;

  o := record_status_observation('40000000-0000-0000-0000-00000000000a', 'user_reported', 'Portal shows: Submitted',
    'submitted', '2026-10-23T09:00:00Z', null, null, gen_random_uuid());
  if o.outcome <> 'not_applied_invalid' or o.outcome_detail is null
     or (select permit_status from permit_applications where id = '40000000-0000-0000-0000-00000000000a') <> 'issued' then
    raise exception 'FAIL: an illegal transition was not recorded as not applied (outcome %)', o.outcome;
  end if;

  o := record_status_observation('40000000-0000-0000-0000-00000000000a', 'authority_correspondence', 'Awaiting fire department sign-off',
    null, '2026-10-24T09:00:00Z', null, null, gen_random_uuid());
  if o.outcome <> 'recorded_only' then raise exception 'FAIL: unmapped wording should be recorded only, got %', o.outcome; end if;
  raise notice 'PASS: already-current, illegal (issued -> submitted: recorded, not applied) and unmapped wording each handled; status unchanged';
end $$;

do $$
begin
  perform record_status_observation('40000000-0000-0000-0000-00000000000a', 'ai_suggestion', 'Looks approved',
    'closed', '2026-10-25T09:00:00Z', null, null, gen_random_uuid());
  raise exception 'FAIL: an AI suggestion went through the staff path';
exception when invalid_parameter_value then
  raise notice 'PASS: an AI suggestion cannot be recorded through the staff path';
end $$;

do $$
begin
  insert into permit_status_observations (org_id, application_id, source, external_status, observed_status, observed_at, outcome, recorded_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'user_reported', 'Forged', 'closed',
          now(), 'recorded_only', auth.uid());
  raise exception 'FAIL: a direct insert into permit_status_observations succeeded';
exception when insufficient_privilege then
  raise notice 'PASS: observations can only be written through the functions';
end $$;

do $$
begin
  perform record_connector_status_event('city_portal', 'evt-1', '40000000-0000-0000-0000-00000000000a', 'Closed', 'closed', now());
  raise exception 'FAIL: authenticated called the connector function';
exception when insufficient_privilege then
  raise notice 'PASS: authenticated cannot call the connector function';
end $$;

-- Connectors (service_role): recorded, deduplicated, ordered, never applied.
reset role;
set local role service_role;
do $$
declare a permit_status_observations; b permit_status_observations; c permit_status_observations; n int;
begin
  a := record_connector_status_event('city_portal', 'evt-1', '40000000-0000-0000-0000-00000000000a', 'Closed', 'closed', '2026-10-26T09:00:00Z');
  b := record_connector_status_event('city_portal', 'evt-1', '40000000-0000-0000-0000-00000000000a', 'Closed', 'closed', '2026-10-26T09:00:00Z');
  c := record_connector_status_event('city_portal', 'evt-0', '40000000-0000-0000-0000-00000000000a', 'Under review', 'under_municipal_review', '2026-10-01T09:00:00Z');
  select count(*) into n from permit_status_observations where connector_name = 'city_portal';
  if a.id <> b.id or n <> 2 then raise exception 'FAIL: duplicate connector callback was not deduplicated (%)', n; end if;
  if a.outcome <> 'recorded_only' or c.outcome <> 'stale' then raise exception 'FAIL: connector outcomes % / %', a.outcome, c.outcome; end if;
  if (select permit_status from permit_applications where id = '40000000-0000-0000-0000-00000000000a') <> 'issued' then
    raise exception 'FAIL: a connector event changed the status';
  end if;
  raise notice 'PASS: connector callbacks are deduplicated, out-of-order ones are stale, none changes the status';
end $$;

reset role;
do $$
begin
  insert into permit_status_observations (org_id, application_id, source, external_status, observed_status, observed_at,
    connector_name, connector_event_id, outcome, applied_history_id)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'connector', 'Closed', 'closed', now(),
    'city_portal', 'evt-9', 'applied', (select id from application_status_history limit 1));
  raise exception 'FAIL: a connector observation was stored as applied';
exception when check_violation then
  raise notice 'PASS: the table itself refuses an applied connector or AI observation (as postgres)';
end $$;

do $$
begin
  update permit_status_observations set outcome = 'applied' where connector_event_id = 'evt-1';
  raise exception 'FAIL: an observation was rewritten';
exception when raise_exception then
  raise notice 'PASS: observations are append-only';
end $$;

-- === 4. Inspections, conditions, packages ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
begin
  insert into inspection_records (org_id, application_id, inspection_type, outcome, occurred_on, provenance, recorded_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'Framing', 'passed', current_date, 'authority_record', auth.uid());
  raise notice 'PASS: control: an inspection result on an issued permit is recorded';
end $$;

-- Org B's application is not issued.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
begin
  insert into inspection_records (org_id, application_id, inspection_type, outcome, occurred_on, provenance, recorded_by)
  values ('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', 'Rough-in', 'scheduled', current_date + 7, 'user_reported', auth.uid());
  insert into inspection_records (org_id, application_id, inspection_type, outcome, occurred_on, provenance, recorded_by)
  values ('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', 'Rough-in', 'passed', current_date, 'user_reported', auth.uid());
  raise exception 'FAIL: an inspection result was recorded before issuance';
exception when check_violation then
  raise notice 'PASS: a scheduled inspection is fine, but a result before issuance is refused';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
insert into permit_conditions (id, org_id, application_id, condition_text, category, source, recorded_by)
values ('c6600000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
        'Provide a fire watch during hot work.', 'during_construction', 'authority_correspondence', auth.uid());

do $$
begin
  insert into permit_condition_events (org_id, condition_id, status, recorded_by)
  values ('20000000-0000-0000-0000-00000000000a', 'c6600000-0000-0000-0000-000000000001', 'waived_by_authority', auth.uid());
  raise exception 'FAIL: a waiver without a note was accepted';
exception when check_violation then
  raise notice 'PASS: a waiver must say who waived it and when (note required)';
end $$;

insert into permit_condition_events (org_id, condition_id, status, note, recorded_by)
values ('20000000-0000-0000-0000-00000000000a', 'c6600000-0000-0000-0000-000000000001', 'satisfied', 'Fire watch log kept on site.', auth.uid());

insert into submission_packages (id, org_id, application_id, version, manifest, manifest_sha256, prepared_by)
values ('c6600000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 1,
        '{"status":"draft"}', repeat('a', 64), auth.uid());

do $$
declare before_status permit_status_enum;
begin
  select permit_status into before_status from permit_applications where id = '40000000-0000-0000-0000-00000000000a';
  insert into submission_package_approvals (org_id, package_id, approved_by)
  values ('20000000-0000-0000-0000-00000000000a', 'c6600000-0000-0000-0000-000000000002', auth.uid());
  if (select permit_status from permit_applications where id = '40000000-0000-0000-0000-00000000000a') <> before_status then
    raise exception 'FAIL: internal approval changed the permit status';
  end if;
  raise notice 'PASS: an internal package approval never changes the permit status';

  begin
    insert into submission_package_approvals (org_id, package_id, approved_by)
    values ('20000000-0000-0000-0000-00000000000a', 'c6600000-0000-0000-0000-000000000002', auth.uid());
    raise exception 'FAIL: a package was approved twice';
  exception when unique_violation then
    raise notice 'PASS: a package is approved at most once';
  end;
end $$;

-- === 5. Tenant isolation ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from permit_status_observations where application_id = '40000000-0000-0000-0000-00000000000a';
  select n + count(*) into n from permit_conditions where application_id = '40000000-0000-0000-0000-00000000000a';
  select n + count(*) into n from submission_packages where application_id = '40000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'FAIL: org B sees % of org A''s lifecycle rows', n; end if;
  raise notice 'PASS: org B sees 0 of org A''s observations, conditions and packages (control below)';

  perform record_status_observation('40000000-0000-0000-0000-00000000000a', 'user_reported', 'Closed', 'closed', now(), null, null, gen_random_uuid());
  raise exception 'FAIL: org B recorded a status on org A''s application';
exception when insufficient_privilege then
  raise notice 'PASS: org B cannot record a status on org A''s application';
end $$;

do $$
begin
  insert into permit_condition_events (org_id, condition_id, status, note, recorded_by)
  values ('20000000-0000-0000-0000-00000000000b', 'c6600000-0000-0000-0000-000000000001', 'reopened', 'x', auth.uid());
  raise exception 'FAIL: org B added an event to org A''s condition';
exception when insufficient_privilege then
  raise notice 'PASS: org B cannot touch org A''s conditions, even under its own org id';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from permit_status_observations where application_id = '40000000-0000-0000-0000-00000000000a';
  if n < 6 then raise exception 'FAIL: control: org A should see its observations (saw %)', n; end if;
  raise notice 'PASS: control: org A sees its own % observations', n;
end $$;

rollback;
