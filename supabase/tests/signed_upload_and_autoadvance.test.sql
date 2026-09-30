-- 20260806000076_signed_upload_and_status_autoadvance.sql.
-- Proves:
--   1. record_uploaded_signed_form(): submission-tier roles only, own org
--      only, path/filename must belong to the application; the upload becomes
--      the filing's latest document and withdraws a pending signature request.
--   2. advance_permit_status_after_generation(): service role only; walks
--      Intake -> Internal review through the legal steps, recording each as a
--      system change; never touches Ready to submit or later.

begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated',
   'org-a-member-upload@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated',
   'org-a-pm-upload@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;
insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000d1', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000d2', 'permit_manager')
on conflict (org_id, user_id) do nothing;

update permit_applications set status = 'documents_generated' where id = '40000000-0000-0000-0000-00000000000a';
insert into generated_documents (application_id, permit_type_filing_id, storage_path, original_filename, fill_method)
values ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
        '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/aa-filled.pdf',
        '00000000-0000-0000-0004-000000000001-filled.pdf', 'acroform');
insert into permit_signature_requests (id, org_id, application_id, permit_type_filing_id, signer_role, signer_name, signer_email, requested_by)
values ('72000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0004-000000000001', 'applicant', 'Jordan', 'jordan@example.test', '10000000-0000-0000-0000-00000000000a');

set local role authenticated;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
do $$
begin
  perform record_uploaded_signed_form('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/bb-00000000-0000-0000-0004-000000000001-signed-upload.pdf',
    '00000000-0000-0000-0004-000000000001-signed-upload.pdf');
  raise exception 'FAIL: plain member recorded a signed upload';
exception
  when sqlstate '42501' then
    raise notice 'PASS: plain member cannot record a signed upload.';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
do $$
declare
  v_doc uuid;
  v_latest uuid;
begin
  begin
    perform record_uploaded_signed_form('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
      '20000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-00000000000a/bb-x-signed-upload.pdf',
      '00000000-0000-0000-0004-000000000001-signed-upload.pdf');
    raise exception 'FAIL: accepted a path outside the application';
  exception
    when others then
      if sqlerrm not like 'invalid_path%' then raise; end if;
  end;
  begin
    perform record_uploaded_signed_form('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
      '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/bb-evil.pdf', 'evil.pdf');
    raise exception 'FAIL: accepted an arbitrary filename';
  exception
    when others then
      if sqlerrm not like 'invalid_filename%' then raise; end if;
  end;
  raise notice 'PASS: the path and filename must belong to this application and filing.';

  v_doc := record_uploaded_signed_form('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/bb-00000000-0000-0000-0004-000000000001-signed-upload.pdf',
    '00000000-0000-0000-0004-000000000001-signed-upload.pdf');
  select id into v_latest from generated_documents
  where application_id = '40000000-0000-0000-0000-00000000000a' and permit_type_filing_id = '00000000-0000-0000-0004-000000000001'
  order by created_at desc, id desc limit 1;
  if v_latest is distinct from v_doc or (select fill_method from generated_documents where id = v_doc) <> 'uploaded' then
    raise exception 'FAIL: the uploaded signed copy should be the filing''s latest document';
  end if;
  if (select status from permit_signature_requests where id = '72000000-0000-0000-0000-000000000001') <> 'cancelled' then
    raise exception 'FAIL: the pending signature request should be withdrawn';
  end if;
  raise notice 'PASS: permit manager uploads the signed copy; it becomes the latest form and withdraws the pending request.';

  begin
    perform advance_permit_status_after_generation('40000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: authenticated advanced the status directly';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: only the service role advances the status after generation.';
  end;
end $$;

-- Org B owner cannot upload into org A.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
begin
  perform record_uploaded_signed_form('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/cc-00000000-0000-0000-0004-000000000001-signed-upload.pdf',
    '00000000-0000-0000-0004-000000000001-signed-upload.pdf');
  raise exception 'FAIL (tenant isolation): org B recorded an upload in org A';
exception
  when sqlstate '42501' then
    raise notice 'PASS (tenant isolation): org B cannot upload into org A.';
end $$;

reset role;
set local role service_role;

do $$
declare
  v_status permit_status_enum;
  v_steps int;
begin
  v_status := advance_permit_status_after_generation('40000000-0000-0000-0000-00000000000a');
  select count(*) into v_steps from application_status_history
  where application_id = '40000000-0000-0000-0000-00000000000a' and reason = 'Filled forms generated' and changed_by is null;
  if v_status <> 'internal_review' or v_steps <> 3 then
    raise exception 'FAIL: expected Intake -> Internal review in 3 recorded system steps (got %, % steps)', v_status, v_steps;
  end if;
  if advance_permit_status_after_generation('40000000-0000-0000-0000-00000000000a') <> 'internal_review'
     or (select count(*) from application_status_history where application_id = '40000000-0000-0000-0000-00000000000a' and reason = 'Filled forms generated') <> 3 then
    raise exception 'FAIL: a second call should change nothing';
  end if;
  raise notice 'PASS: generation walks the status to Internal review once, recording each legal step.';
end $$;

reset role;
update permit_applications set permit_status = 'ready_to_submit' where id = '40000000-0000-0000-0000-00000000000a';
set local role service_role;
do $$
begin
  if advance_permit_status_after_generation('40000000-0000-0000-0000-00000000000a') <> 'ready_to_submit' then
    raise exception 'FAIL: moved an application that was already Ready to submit';
  end if;
  raise notice 'PASS: Ready to submit and later statuses are left alone.';
end $$;

reset role;

rollback;
