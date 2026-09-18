-- Gate 4 (Quotes & Payments), Phase A -- client-portal token extension
-- (20260816000001_client_access_tokens_target_kind.sql). Proves:
--   1. A caller that only sets application_id (every existing insert shape,
--      including client_portal_token_lifecycle.test.sql's own fixtures)
--      gets target_kind = 'permit_application' / target_id = application_id
--      auto-populated by the BEFORE INSERT trigger.
--   2. A caller that explicitly sets target_kind/target_id (the future
--      quote/invoice-link issuance path) has those values stored verbatim,
--      NOT overridden by the trigger.
--   3. The both-set-together CHECK constraint rejects a row with one of
--      the pair set and the other left null.
--   4. application_id itself is untouched by this migration -- still
--      NOT NULL, still the column every pre-existing caller can rely on.
--
-- Regression for the existing test suite is confirmed separately by running
-- client_portal_token_lifecycle.test.sql itself unmodified (see this pass's
-- final report) -- not duplicated here.

begin;

-- ---------------------------------------------------------------------
-- (a) Auto-populate: insert exactly the same shape
-- client_portal_token_lifecycle.test.sql already uses (application_id/
-- org_id/recipient_*/token_hash/status/expires_at only, no target_kind/
-- target_id) and confirm both new columns end up populated.
-- ---------------------------------------------------------------------
do $$
declare
  v_application_id uuid := '74000000-0000-0000-0000-00000000000a';
  v_id uuid;
  v_target_kind text;
  v_target_id uuid;
begin
  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values (
    v_application_id, '74000000-0000-0000-0000-00000000000b',
    'Target-Kind-Test@example.com', 'target-kind-test@example.com',
    encode(digest('target-kind-autopop-token', 'sha256'), 'hex'), 'active', now() + interval '14 days'
  )
  returning id into v_id;

  select target_kind, target_id into v_target_kind, v_target_id from client_access_tokens where id = v_id;

  if v_target_kind is distinct from 'permit_application' or v_target_id is distinct from v_application_id then
    raise exception 'FAIL: auto-populate trigger did not set target_kind=permit_application/target_id=application_id (got target_kind=%, target_id=%)', v_target_kind, v_target_id;
  end if;
  raise notice 'PASS: inserting with only application_id set auto-populates target_kind=permit_application, target_id=application_id (%).', v_target_id;
end $$;

-- ---------------------------------------------------------------------
-- (b) Backfill: existing pre-migration rows (simulated here as a row
-- inserted the old way, matching (a)) end up consistent -- already proven
-- by (a) for a fresh insert; this checks the migration's own backfill
-- UPDATE would have caught a genuinely pre-existing row by asserting no
-- row in this table can have target_kind is null after this migration.
-- ---------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from client_access_tokens where target_kind is null;
  if v_count <> 0 then
    raise exception 'FAIL: % row(s) still have a null target_kind after the backfill migration', v_count;
  end if;
  raise notice 'PASS: no client_access_tokens row has a null target_kind (backfill + trigger together cover every row).';
end $$;

-- ---------------------------------------------------------------------
-- (c) Explicit override path: the future quote/invoice-link issuance
-- caller sets target_kind/target_id itself -- the trigger must NOT
-- override an explicitly-provided value with the application_id default.
-- ---------------------------------------------------------------------
do $$
declare
  v_application_id uuid := '74000000-0000-0000-0000-00000000000c';
  v_estimate_id uuid := '74000000-0000-0000-0000-00000000000d';
  v_id uuid;
  v_target_kind text;
  v_target_id uuid;
begin
  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at, target_kind, target_id
  ) values (
    v_application_id, '74000000-0000-0000-0000-00000000000b',
    'Estimate-Link-Test@example.com', 'estimate-link-test@example.com',
    encode(digest('target-kind-explicit-token', 'sha256'), 'hex'), 'active', now() + interval '14 days',
    'estimate', v_estimate_id
  )
  returning id into v_id;

  select target_kind, target_id into v_target_kind, v_target_id from client_access_tokens where id = v_id;

  if v_target_kind is distinct from 'estimate' or v_target_id is distinct from v_estimate_id then
    raise exception 'FAIL: explicit target_kind/target_id was overridden by the auto-populate trigger (got target_kind=%, target_id=%)', v_target_kind, v_target_id;
  end if;
  raise notice 'PASS: an explicit target_kind=estimate/target_id is stored verbatim, not overridden by the trigger (%/%).', v_target_kind, v_target_id;
end $$;

-- ---------------------------------------------------------------------
-- (d) Both-set-together CHECK: target_kind set with target_id left null
-- is rejected (half a pointer is not a legal value).
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into client_access_tokens (
      application_id, org_id, recipient_email_display, recipient_email,
      token_hash, status, expires_at, target_kind, target_id
    ) values (
      '74000000-0000-0000-0000-00000000000e', '74000000-0000-0000-0000-00000000000b',
      'Half-Pointer-Test@example.com', 'half-pointer-test@example.com',
      encode(digest('target-kind-half-pointer-token', 'sha256'), 'hex'), 'active', now() + interval '14 days',
      'invoice', null
    );
    raise exception 'FAIL: a row with target_kind set and target_id null was accepted';
  exception
    when check_violation then
      raise notice 'PASS: target_kind set with target_id null is rejected by client_access_tokens_target_kind_id_check (%)', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
-- (e) application_id itself is untouched by this migration: still
-- NOT NULL, and a row without it still fails exactly as before.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into client_access_tokens (
      org_id, recipient_email_display, recipient_email,
      token_hash, status, expires_at
    ) values (
      '74000000-0000-0000-0000-00000000000b',
      'No-Application-Id-Test@example.com', 'no-application-id-test@example.com',
      encode(digest('no-application-id-token', 'sha256'), 'hex'), 'active', now() + interval '14 days'
    );
    raise exception 'FAIL: a row with no application_id was accepted -- this migration must not have relaxed that NOT NULL';
  exception
    when not_null_violation then
      raise notice 'PASS: application_id is still NOT NULL, untouched by this purely-additive migration (%)', sqlerrm;
  end;
end $$;

rollback;
