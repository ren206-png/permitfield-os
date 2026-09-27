-- E-signature Stage B / 20260806000073_permit_form_esignatures.sql.
-- Proves:
--   1. Only Vancouver is marked as accepting e-signatures, with its source,
--      and acceptance can never be stored without one. Every mapped form has
--      an applicant signature slot.
--   2. request_permit_signature(): submission-tier roles only; refuses
--      authorities that haven't confirmed e-signatures, forms without a slot
--      for the signer, and applications not at documents_generated; a new
--      request replaces the pending one. Sessions can't write the tables
--      directly.
--   3. record_permit_signature(): service role only; refuses a document that
--      is no longer the latest, invalid consent/signatures, and a second
--      signature; on success the signed document becomes the filing's latest
--      and the evidence row is append-only.
--   4. Tenant isolation.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from authorities where esignature_accepted;
  if v_count <> 1 or not exists (
    select 1 from authorities where id = '00000000-0000-0000-0002-000000000005' and esignature_accepted
      and esignature_source_url is not null and esignature_verified_on is not null
  ) then
    raise exception 'FAIL: expected exactly Vancouver to accept e-signatures, with a source (found % accepting)', v_count;
  end if;
  raise notice 'PASS: only Vancouver accepts e-signatures, and its source is recorded.';

  begin
    update authorities set esignature_accepted = true where id = '00000000-0000-0000-0002-000000000001';
    raise exception 'FAIL: marked an authority as accepting e-signatures without a source';
  exception
    when check_violation then
      raise notice 'PASS: e-signature acceptance cannot be stored without its source (%)', sqlerrm;
  end;

  select count(*) into v_count from permit_type_filings f
  where f.form_template_path is not null
    and not exists (select 1 from permit_form_signature_slots s where s.permit_type_filing_id = f.id and s.signer_role = 'applicant');
  if v_count <> 0 then
    raise exception 'FAIL: % form(s) with a template but no applicant signature slot', v_count;
  end if;
  raise notice 'PASS: every form with a template has an applicant signature slot.';
end $$;

-- Setup (as postgres): org A's seeded application (Toronto, filings 0004-01
-- Toronto and 0004-02 ESA) has its forms generated, and for this test only
-- Toronto accepts e-signatures.
update authorities set esignature_accepted = true, esignature_source_url = 'https://example.test/source', esignature_verified_on = '2026-09-26'
where id = '00000000-0000-0000-0002-000000000001';
update permit_applications set status = 'documents_generated' where id = '40000000-0000-0000-0000-00000000000a';
insert into generated_documents (id, application_id, permit_type_filing_id, storage_path, original_filename, fill_method)
values ('71000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
        '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/aa-filled.pdf', 'filled.pdf', 'acroform'),
       ('71000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000002',
        '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/bb-filled.pdf', 'filled.pdf', 'overlay');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e7', 'authenticated', 'authenticated',
   'org-a-member-esign@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-0000000000e8', 'authenticated', 'authenticated',
   'org-a-pm-esign@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e7', 'member'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e8', 'permit_manager')
on conflict (org_id, user_id) do nothing;

create temporary table esign_ids (name text primary key, id uuid);
grant all on esign_ids to authenticated, service_role;

set local role authenticated;

-- Plain member: may not request.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e7","role":"authenticated"}';
do $$
begin
  perform request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    'applicant', 'Jordan Rivera', 'jordan@example.test');
  raise exception 'FAIL: plain member requested a signature';
exception
  when others then
    if sqlerrm not like 'not_authorized%' then raise; end if;
    raise notice 'PASS: plain member cannot request a signature.';
end $$;

-- Permit manager.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e8","role":"authenticated"}';
do $$
declare
  v_first uuid;
  v_second uuid;
  v_status text;
begin
  begin
    perform request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000002',
      'applicant', 'Jordan Rivera', 'jordan@example.test');
    raise exception 'FAIL: requested a signature for an authority that has not confirmed e-signatures (ESA)';
  exception
    when others then
      if sqlerrm not like 'esignature_not_accepted%' then raise; end if;
      raise notice 'PASS: no request where the authority has not confirmed e-signatures.';
  end;

  begin
    perform request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
      'owner', 'Pat Owner', 'pat@example.test');
    raise exception 'FAIL: requested an owner signature on a form with no owner slot';
  exception
    when others then
      if sqlerrm not like 'no_signature_slot%' then raise; end if;
      raise notice 'PASS: no request for a signer the form has no line for.';
  end;

  v_first := request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    'applicant', 'Jordan Rivera', 'jordan@example.test');
  v_second := request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    'applicant', 'Jordan Rivera', 'jordan.rivera@example.test');
  select status into v_status from permit_signature_requests where id = v_first;
  if v_status <> 'cancelled' then
    raise exception 'FAIL: the earlier pending request should be cancelled by the new one, is %', v_status;
  end if;
  insert into esign_ids values ('request', v_second);
  raise notice 'PASS: permit manager requests a signature; a new request replaces the pending one.';

  begin
    update permit_signature_requests set status = 'signed' where id = v_second;
    raise exception 'FAIL: session updated a signature request directly';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: sessions cannot update signature requests directly (%)', sqlerrm;
  end;

  begin
    perform record_permit_signature(v_second, '20000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000001',
      repeat('a', 64), 'x/y/z.pdf', 'signed.pdf', 'Jordan Rivera', 'consent', 'typed', null);
    raise exception 'FAIL: authenticated recorded a signature';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: only the service role can record a signature (%)', sqlerrm;
  end;
end $$;

reset role;
set local role service_role;

do $$
declare
  v_request uuid := (select id from esign_ids where name = 'request');
  v_signed uuid;
  v_latest uuid;
  v_status text;
begin
  begin
    perform record_permit_signature(v_request, '20000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000002',
      repeat('a', 64), 'x/y/z.pdf', 'signed.pdf', 'Jordan Rivera', 'consent', 'typed', null);
    raise exception 'FAIL: signed a document that is not the filing''s latest';
  exception
    when others then
      if sqlerrm not like 'stale_document%' then raise; end if;
      raise notice 'PASS: a document that is no longer the latest cannot be signed.';
  end;

  begin
    perform record_permit_signature(v_request, '20000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000001',
      repeat('a', 64), 'x/y/z.pdf', 'signed.pdf', 'Jordan Rivera', '', 'typed', null);
    raise exception 'FAIL: signed without consent';
  exception
    when others then
      if sqlerrm not like 'esign_consent_required%' then raise; end if;
      raise notice 'PASS: consent is required.';
  end;

  begin
    perform record_permit_signature(v_request, '20000000-0000-0000-0000-00000000000b', '71000000-0000-0000-0000-000000000001',
      repeat('a', 64), 'x/y/z.pdf', 'signed.pdf', 'Jordan Rivera', 'consent', 'typed', null);
    raise exception 'FAIL: recorded a signature under the wrong org';
  exception
    when others then
      if sqlerrm not like 'request_not_found%' then raise; end if;
      raise notice 'PASS: the request must belong to the given org.';
  end;

  v_signed := record_permit_signature(v_request, '20000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000001',
    repeat('a', 64), '20000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-00000000000a/cc-signed.pdf', 'signed.pdf',
    'Jordan Rivera', 'I agree to sign electronically.', 'typed', null, '203.0.113.7', 'test-agent');

  select status into v_status from permit_signature_requests where id = v_request;
  select id into v_latest from generated_documents
  where application_id = '40000000-0000-0000-0000-00000000000a' and permit_type_filing_id = '00000000-0000-0000-0004-000000000001'
  order by created_at desc, id desc limit 1;
  if v_status <> 'signed' or v_latest is distinct from v_signed
     or not exists (select 1 from permit_signatures where request_id = v_request and signed_document_id = v_signed and source_document_id = '71000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: signing should mark the request signed (is %), make the signed document the latest, and record the evidence', v_status;
  end if;
  raise notice 'PASS: a valid signature produces the signed document as the filing''s latest, with evidence.';

  begin
    perform record_permit_signature(v_request, '20000000-0000-0000-0000-00000000000a', v_signed,
      repeat('a', 64), 'x/y/z.pdf', 'signed.pdf', 'Jordan Rivera', 'consent', 'typed', null);
    raise exception 'FAIL: signed the same request twice';
  exception
    when others then
      if sqlerrm not like 'not_pending%' then raise; end if;
      raise notice 'PASS: a request can only be signed once.';
  end;

  begin
    update permit_signatures set typed_name = 'Someone Else' where request_id = v_request;
    raise exception 'FAIL: permit_signatures row was updated';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: signature evidence is append-only (%)', sqlerrm;
  end;
end $$;

reset role;
set local role authenticated;

-- Permit manager cannot cancel a signed request.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e8","role":"authenticated"}';
do $$
begin
  perform cancel_permit_signature_request((select id from esign_ids where name = 'request'));
  raise exception 'FAIL: cancelled a signed request';
exception
  when others then
    if sqlerrm not like 'not_pending%' then raise; end if;
    raise notice 'PASS: a signed request cannot be cancelled.';
end $$;

-- Org B owner: sees nothing of org A's, cannot request on org A's application.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select (select count(*) from permit_signature_requests where org_id = '20000000-0000-0000-0000-00000000000a')
       + (select count(*) from permit_signatures where org_id = '20000000-0000-0000-0000-00000000000a')
  into v_count;
  if v_count <> 0 then
    raise exception 'FAIL (tenant isolation): org B sees % org A signature row(s)', v_count;
  end if;
  begin
    perform request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
      'applicant', 'Mallory', 'mallory@example.test');
    raise exception 'FAIL (tenant isolation): org B requested a signature on org A''s application';
  exception
    when others then
      if sqlerrm not like 'not_authorized%' then raise; end if;
  end;
  raise notice 'PASS (tenant isolation): org B cannot see or request org A signatures.';
end $$;

reset role;

-- Once submitted, no new requests.
update permit_applications set status = 'submitted' where id = '40000000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000e8","role":"authenticated"}';
do $$
begin
  perform request_permit_signature('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0004-000000000001',
    'applicant', 'Jordan Rivera', 'jordan@example.test');
  raise exception 'FAIL: requested a signature on a submitted application';
exception
  when others then
    if sqlerrm not like 'not_ready%' then raise; end if;
    raise notice 'PASS: no signature requests once the application is submitted.';
end $$;

reset role;

rollback;
