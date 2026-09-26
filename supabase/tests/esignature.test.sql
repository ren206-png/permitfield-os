-- E-signature, Stage A / 20260806000069_esignature_consent_and_signature.sql.
-- Proves assert_valid_esignature() -- the shared check both acceptance
-- functions run before inserting -- rejects every invalid shape and accepts
-- the two valid ones, and that `authenticated` cannot call it directly.
-- (The end-to-end insert path is covered in estimate_acceptances.test.sql
-- and change_orders.test.sql.)

begin;

set local role service_role;

do $$
declare
  v_png text := 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  v_case record;
begin
  perform assert_valid_esignature('I agree.', 'typed', null);
  perform assert_valid_esignature('I agree.', 'drawn', v_png);
  raise notice 'PASS: a typed signature and a drawn PNG signature with consent are both accepted.';

  for v_case in
    select * from (values
      ('missing consent', null::text, 'typed'::text, null::text, 'esign_consent_required'),
      ('blank consent', '   ', 'typed', null, 'esign_consent_required'),
      ('missing method', 'I agree.', null, null, 'invalid_signature_method'),
      ('unknown method', 'I agree.', 'stamp', null, 'invalid_signature_method'),
      ('drawn without image', 'I agree.', 'drawn', null, 'invalid_signature_image'),
      ('drawn non-PNG', 'I agree.', 'drawn', '/9j/4AAQSkZJRgABAQ==', 'invalid_signature_image'),
      ('drawn oversized', 'I agree.', 'drawn', 'iVBORw0KGgo' || repeat('A', 400000), 'invalid_signature_image'),
      ('typed with image', 'I agree.', 'typed', 'iVBORw0KGgoAAAA', 'invalid_signature_image')
    ) as t(label, consent, method, png, expected)
  loop
    begin
      perform assert_valid_esignature(v_case.consent, v_case.method, v_case.png);
      raise exception 'FAIL: % was accepted', v_case.label;
    exception
      when raise_exception then
        if sqlerrm not like v_case.expected || '%' then
          raise exception 'FAIL: % raised "%" instead of %', v_case.label, sqlerrm, v_case.expected;
        end if;
    end;
  end loop;
  raise notice 'PASS: missing/blank consent, bad methods, and missing, non-PNG, oversized, or stray images are all rejected.';
end $$;

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    perform assert_valid_esignature('I agree.', 'typed', null);
    raise exception 'FAIL: authenticated could call assert_valid_esignature()';
  exception
    when sqlstate '42501' then
      raise notice 'PASS: authenticated has no execute grant on assert_valid_esignature() (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
