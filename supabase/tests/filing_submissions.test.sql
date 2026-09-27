-- Submit to authority / 20260806000070_authority_submissions.sql.
-- Proves:
--   1. ESA and Richmond carry their verified intake addresses with a source,
--      and an address can never be stored without one.
--   2. Only submission-tier roles can record a filing_submissions row, and
--      only as themselves; plain members cannot.
--   3. Row shape CHECKs (email rows need a recipient; failures need an error).
--   4. Tenant isolation and append-only.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from authorities
  where (id = '00000000-0000-0000-0002-000000000006' and submission_email = 'BuildingApplications@richmond.ca')
     or (id = '00000000-0000-0000-0002-000000000002' and submission_email = 'esa.cambridge@electricalsafety.on.ca');
  if v_count <> 2 then
    raise exception 'FAIL: expected verified submission emails on Richmond and ESA, found %', v_count;
  end if;
  select count(*) into v_count from authorities
  where submission_email is not null and (submission_email_source_url is null or submission_email_verified_on is null);
  if v_count <> 0 then
    raise exception 'FAIL: % authority email(s) without a recorded source', v_count;
  end if;
  raise notice 'PASS: Richmond and ESA carry verified, sourced intake emails.';

  begin
    update authorities set submission_email = 'someone@example.com', submission_email_source_url = null, submission_email_verified_on = null
    where id = '00000000-0000-0000-0002-000000000001';
    raise exception 'FAIL: stored an authority email without a source';
  exception
    when check_violation then
      raise notice 'PASS: an authority email cannot be stored without its source (%)', sqlerrm;
  end;
end $$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f5', 'authenticated', 'authenticated',
   'org-a-member-submit@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000f6', 'authenticated', 'authenticated',
   'org-a-pm-submit@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f5', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000f6', 'permit_manager')
on conflict (org_id, user_id) do nothing;

-- Org A's seeded application is a Toronto Electrical Service Upgrade, whose
-- second filing (0004-...02) goes to ESA (0002-...02).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f6","role":"authenticated"}';

do $$
begin
  insert into filing_submissions (org_id, application_id, permit_type_filing_id, authority_id, method, status, to_email, cc_email, subject, submitted_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000002',
          '00000000-0000-0000-0002-000000000002', 'email', 'sent', 'esa.cambridge@electricalsafety.on.ca', 'office@acme.example',
          '123 Test St, Electrical Service Upgrade', '10000000-0000-0000-0000-0000000000f6');
  insert into filing_submissions (org_id, application_id, permit_type_filing_id, authority_id, method, status, external_reference, submitted_by)
  values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
          '00000000-0000-0000-0002-000000000001', 'portal', 'recorded', 'BP-2026-01234', '10000000-0000-0000-0000-0000000000f6');
  raise notice 'PASS: permit_manager records an email submission and a portal submission.';

  begin
    insert into filing_submissions (org_id, application_id, permit_type_filing_id, authority_id, method, status, submitted_by)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
            '00000000-0000-0000-0002-000000000001', 'portal', 'recorded', '10000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: recorded a submission attributed to another user';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: submitted_by must be the caller (%)', sqlerrm;
  end;

  begin
    insert into filing_submissions (org_id, application_id, permit_type_filing_id, authority_id, method, status, submitted_by)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000002',
            '00000000-0000-0000-0002-000000000002', 'email', 'sent', '10000000-0000-0000-0000-0000000000f6');
    raise exception 'FAIL: email submission without a recipient accepted';
  exception
    when check_violation then
      raise notice 'PASS: an email submission must record its recipient.';
  end;

  begin
    insert into filing_submissions (org_id, application_id, permit_type_filing_id, authority_id, method, status, to_email, submitted_by)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000002',
            '00000000-0000-0000-0002-000000000002', 'email', 'failed', 'x@example.com', '10000000-0000-0000-0000-0000000000f6');
    raise exception 'FAIL: failed email submission without an error message accepted';
  exception
    when check_violation then
      raise notice 'PASS: a failed submission must record why.';
  end;

  begin
    update filing_submissions set status = 'failed', error_message = 'x';
    raise exception 'FAIL: filing_submissions UPDATE succeeded';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: filing_submissions cannot be updated (%)', sqlerrm;
  end;
end $$;

-- Plain member: can see the org's submissions, cannot record one.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000f5","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from filing_submissions where application_id = '40000000-0000-0000-0000-00000000000a';
  if v_count <> 2 then
    raise exception 'FAIL: plain member should see the 2 org submissions, saw %', v_count;
  end if;
  begin
    insert into filing_submissions (org_id, application_id, permit_type_filing_id, authority_id, method, status, submitted_by)
    values ('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
            '00000000-0000-0000-0002-000000000001', 'portal', 'recorded', '10000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL: plain member recorded a submission';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: plain member can read but not record submissions (%)', sqlerrm;
  end;
end $$;

-- Org B owner sees none of org A's submissions.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from filing_submissions where org_id = '20000000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B sees % org A submission(s)', v_count;
  end if;
  raise notice 'PASS (tenant isolation): org B cannot see org A submissions.';
end $$;

reset role;

rollback;
