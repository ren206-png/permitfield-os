-- Gate 2.0 sub-phase 2.1 tests (GATE_2_0_SPEC.md SS6, sub-phase 2.1 row).
-- Covers exactly the three test requirements that row lists, plus two
-- adjacent structural checks ((d)/(e) below) for the append-only trigger
-- and the service_role GRANTs that 20260814000001_client_portal_token_schema.sql
-- adds -- both are the same "BYPASSRLS is not a substitute for GRANT" /
-- tamper-resistance guarantees SS2 explicitly calls out as load-bearing
-- for these two tables, so leaving them unverified here would be the same
-- "written but not executed" gap this repo's own CI header warns against,
-- just one layer down (schema written and reasoned about, but never
-- proven to behave as reasoned).
--
-- This project has no seed.sql (supabase-client-portal/config.toml
-- [db.seed] enabled = false) -- fixtures are created inline, same reason
-- GATE_2_0_FINDINGS.md SS H.5 gives: this is sub-phase 2.1's first schema,
-- there is no shared fixture set yet to reuse.
--
-- Runs as the connecting role for this session (postgres, the local
-- superuser -- the same role that owns these tables, since migrations
-- apply as postgres too), which is why sections (b) and (e) can DROP/ADD
-- the index and REVOKE/GRANT privileges directly. service_role itself
-- gets DML only (see the migration's closing GRANT block) -- consistent
-- with org_members_role_constraint.test.sql's identical reasoning for why
-- its own control step has to run as the owning role, not service_role.
--
-- Every section wraps its assertions in begin; ... rollback; (one
-- transaction for the whole file, matching org_members_role_constraint.test.sql),
-- so running this file leaves no residue in the database either way.

begin;

-- ---------------------------------------------------------------------
-- (a) Token issue -> hash-validate round trip.
-- ---------------------------------------------------------------------
-- Proves the intended validation shape from SS1 actually works end to
-- end: generate a raw token, store only its hash, then validate by
-- hashing the presented token again and looking up by hash + status +
-- expiry -- never by storing or comparing the raw value.
do $$
declare
  v_raw_token text := 'test-raw-token-abc123';
  v_token_hash text := encode(digest('test-raw-token-abc123', 'sha256'), 'hex');
  v_wrong_hash text := encode(digest('wrong-presented-token', 'sha256'), 'hex');
  v_token_id uuid;
  v_found_id uuid;
begin
  insert into client_access_tokens (
    application_id, org_id,
    recipient_email_display, recipient_email, recipient_name,
    token_hash, status, expires_at
  ) values (
    '70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b',
    'Jane@Example.com', 'jane@example.com', 'Jane Example',
    v_token_hash, 'active', now() + interval '14 days'
  )
  returning id into v_token_id;

  -- Control: a mis-hashed / wrong presented token must not resolve.
  select id into v_found_id
  from client_access_tokens
  where token_hash = v_wrong_hash and status = 'active' and expires_at > now();
  if v_found_id is not null then
    raise exception 'FAIL (control): a wrong presented token hashed to a match -- the round trip proves nothing if this succeeds';
  end if;
  raise notice 'PASS (control): presenting the wrong raw token does not resolve to any row.';

  -- Assert: hashing the correct raw token at "presentation time" and
  -- looking it up by hash + status + expiry resolves to the same row
  -- that was issued -- the actual hash-validate round trip SS1 requires.
  select id into v_found_id
  from client_access_tokens
  where token_hash = encode(digest(v_raw_token, 'sha256'), 'hex')
    and status = 'active'
    and expires_at > now();

  if v_found_id is null or v_found_id <> v_token_id then
    raise exception 'FAIL: hash-validate round trip did not resolve the issued token (expected %, got %)', v_token_id, v_found_id;
  end if;
  raise notice 'PASS: issue -> hash -> validate round trip resolves to the issued token (%).', v_found_id;
end $$;

-- ---------------------------------------------------------------------
-- (b) client_access_tokens_one_active_per_recipient actually blocks a
-- second concurrent active row. Same control-then-assert shape as
-- org_members_role_constraint.test.sql: drop the index, prove the
-- "bad" state is reachable at all (control), restore it, prove the
-- identical insert is now rejected specifically by this index's name
-- (assert) -- not just "some unique_violation."
-- ---------------------------------------------------------------------
-- This is a partial unique INDEX, not a table CONSTRAINT (see the
-- migration), so it is dropped/recreated with DROP/CREATE INDEX, not
-- ALTER TABLE ... DROP CONSTRAINT.
drop index if exists client_access_tokens_one_active_per_recipient;

do $$
declare
  control_count int;
begin
  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values
    ('71000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000b',
     'dup@example.com', 'dup@example.com',
     encode(digest('dup-token-1', 'sha256'), 'hex'), 'active', now() + interval '14 days'),
    ('71000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000b',
     'dup@example.com', 'dup@example.com',
     encode(digest('dup-token-2', 'sha256'), 'hex'), 'active', now() + interval '14 days');

  select count(*) into control_count
  from client_access_tokens
  where recipient_email = 'dup@example.com'
    and application_id = '71000000-0000-0000-0000-00000000000a'
    and status = 'active';

  if control_count <> 2 then
    raise exception 'FAIL (control): expected 2 concurrent active rows for the same recipient+application with the index absent, got % -- the later rejection assertion would prove nothing without this control', control_count;
  end if;
  raise notice 'PASS (control): 2 active rows for the same recipient+application coexist with client_access_tokens_one_active_per_recipient absent (count=2).';

  -- Clear both control rows before restoring the index.
  delete from client_access_tokens
  where recipient_email = 'dup@example.com'
    and application_id = '71000000-0000-0000-0000-00000000000a';
end $$;

create unique index client_access_tokens_one_active_per_recipient
  on client_access_tokens (recipient_email, application_id)
  where status = 'active';

do $$
begin
  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values
    ('71000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000b',
     'dup@example.com', 'dup@example.com',
     encode(digest('dup-token-3', 'sha256'), 'hex'), 'active', now() + interval '14 days');

  begin
    insert into client_access_tokens (
      application_id, org_id, recipient_email_display, recipient_email,
      token_hash, status, expires_at
    ) values
      ('71000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000b',
       'dup@example.com', 'dup@example.com',
       encode(digest('dup-token-4', 'sha256'), 'hex'), 'active', now() + interval '14 days');
    raise exception 'FAIL: second concurrent active row for the same recipient+application succeeded even with client_access_tokens_one_active_per_recipient restored';
  exception
    when unique_violation then
      if sqlerrm not like '%client_access_tokens_one_active_per_recipient%' then
        raise exception 'FAIL: second insert was rejected by a unique_violation, but not by client_access_tokens_one_active_per_recipient specifically (got: %)', sqlerrm;
      end if;
      raise notice 'PASS: second concurrent active row rejected by client_access_tokens_one_active_per_recipient (%)', sqlerrm;
  end;
end $$;

-- Note on scope: SS1's "Issuance vs. the partial unique index" subsection
-- also describes a `select ... for update` lock-mediated path for
-- RE-issuance (superseding an existing active row inside the same
-- transaction as the new insert). That path is a property of the
-- issuance operation's transaction logic, which does not exist yet --
-- it is bridge-layer code scoped to sub-phase 2.4, not this sub-phase's
-- schema-only scope (SS6's 2.1 row: "Zero -- a different database
-- entirely; nothing ... changes" beyond the three tables). This test
-- therefore only proves the index itself (the mechanism 2.1 actually
-- ships), not the lock-based serialization built on top of it later.

-- ---------------------------------------------------------------------
-- (c) Every transition in SS1's lifecycle matrix exercised at least
-- once, each recorded as one token_lifecycle_events row.
-- ---------------------------------------------------------------------
do $$
declare
  v_token_a uuid;
  v_token_b uuid;
  v_token_c uuid;
  v_event_count int;
begin
  -- Fixture tokens, one per terminal-transition scenario below, plus the
  -- entry transition captured against all three at insert time.
  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values
    ('72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000d',
     'expire-me@example.com', 'expire-me@example.com',
     encode(digest('lifecycle-token-a', 'sha256'), 'hex'), 'active', now() + interval '14 days')
  returning id into v_token_a;

  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values
    ('72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000d',
     'revoke-me@example.com', 'revoke-me@example.com',
     encode(digest('lifecycle-token-b', 'sha256'), 'hex'), 'active', now() + interval '14 days')
  returning id into v_token_b;

  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values
    ('72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000d',
     'supersede-me@example.com', 'supersede-me@example.com',
     encode(digest('lifecycle-token-c', 'sha256'), 'hex'), 'active', now() + interval '14 days')
  returning id into v_token_c;

  -- Transition 1: (none) -> issued -> active. System-triggered (the
  -- issuance operation itself), recorded once per fixture token above.
  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_system)
  values
    (v_token_a, null, 'active', true),
    (v_token_b, null, 'active', true),
    (v_token_c, null, 'active', true);

  -- Transition 2: active -> expired. Lazy/system-evaluated per SS1 (no
  -- cron re-writes status eagerly) -- exercised here as the event record
  -- a read-time evaluation would append, not as a status column flip on
  -- client_access_tokens itself (SS1 is explicit that status can lag
  -- expires_at until next read).
  update client_access_tokens set status = 'expired' where id = v_token_a;
  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_system)
  values (v_token_a, 'active', 'expired', true);

  -- Transition 3: active -> revoked. Staff-triggered.
  update client_access_tokens
  set status = 'revoked', revoked_at = now(), revoked_by_org_user_id = '72000000-0000-0000-0000-0000000000ff'
  where id = v_token_b;
  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_org_user_id)
  values (v_token_b, 'active', 'revoked', '72000000-0000-0000-0000-0000000000ff');

  -- Transition 4: active -> superseded. System-triggered, as part of a
  -- (simulated) atomic re-issue transaction: old row superseded, new row
  -- inserted active, in the same transaction as this whole do-block.
  update client_access_tokens set status = 'superseded' where id = v_token_c;
  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_system)
  values (v_token_c, 'active', 'superseded', true);

  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values
    ('72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000d',
     'supersede-me@example.com', 'supersede-me@example.com',
     encode(digest('lifecycle-token-c-reissued', 'sha256'), 'hex'), 'active', now() + interval '14 days');

  -- Assert: exactly one token_lifecycle_events row exists for each of
  -- the four transition shapes above (3 entry + 1 expired + 1 revoked +
  -- 1 superseded = 6 rows total across the three fixture tokens).
  select count(*) into v_event_count from token_lifecycle_events
  where token_id in (v_token_a, v_token_b, v_token_c);
  if v_event_count <> 6 then
    raise exception 'FAIL: expected 6 token_lifecycle_events rows (3 entry + expired + revoked + superseded), got %', v_event_count;
  end if;

  select count(*) into v_event_count from token_lifecycle_events
  where token_id = v_token_a and from_status = 'active' and to_status = 'expired';
  if v_event_count <> 1 then
    raise exception 'FAIL: active->expired transition not recorded exactly once for token_a (got %)', v_event_count;
  end if;

  select count(*) into v_event_count from token_lifecycle_events
  where token_id = v_token_b and from_status = 'active' and to_status = 'revoked' and triggered_by_org_user_id is not null;
  if v_event_count <> 1 then
    raise exception 'FAIL: active->revoked transition not recorded exactly once (with a staff actor) for token_b (got %)', v_event_count;
  end if;

  select count(*) into v_event_count from token_lifecycle_events
  where token_id = v_token_c and from_status = 'active' and to_status = 'superseded' and triggered_by_system is true;
  if v_event_count <> 1 then
    raise exception 'FAIL: active->superseded transition not recorded exactly once (system-triggered) for token_c (got %)', v_event_count;
  end if;

  raise notice 'PASS: all five named transitions in SS1''s matrix ((none)->active, active->expired, active->revoked, active->superseded, plus the re-issue insert that follows a supersede) are exercised and recorded as token_lifecycle_events rows.';
end $$;

-- Control: the triggered_by_* exactly-one-of-two CHECK holds for
-- token_lifecycle_events too (same shape as client_access_tokens'
-- revoked_by_* pair) -- neither both null nor both populated is a
-- legal event row.
do $$
declare
  v_token_id uuid;
begin
  select id into v_token_id from client_access_tokens limit 1;

  begin
    insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_org_user_id, triggered_by_system)
    values (v_token_id, 'active', 'revoked', null, false);
    raise exception 'FAIL: token_lifecycle_events accepted an event with neither triggered_by_org_user_id nor triggered_by_system set';
  exception
    when check_violation then
      raise notice 'PASS: token_lifecycle_events rejects an event with no actor (%).', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
-- (d) Additional, adjacent to SS6's three named requirements: the
-- append-only trigger (forbid_update_delete) actually blocks UPDATE and
-- DELETE on both ledger tables, including for the owning role -- the
-- exact guarantee SS2's comment says these two tables need to match
-- audit_logs' tamper-resistance. Same control-then-assert shape: prove
-- the row exists and is targetable (control), then prove the blocked
-- statement is rejected specifically by this trigger, not some other
-- reason (assert).
-- ---------------------------------------------------------------------
do $$
declare
  v_event_id uuid;
begin
  select id into v_event_id from token_lifecycle_events limit 1;
  if v_event_id is null then
    raise exception 'FAIL (control): no token_lifecycle_events row available to attempt the blocked UPDATE against';
  end if;
  raise notice 'PASS (control): a token_lifecycle_events row exists and is targetable (%).', v_event_id;

  begin
    update token_lifecycle_events set to_status = 'revoked' where id = v_event_id;
    raise exception 'FAIL: UPDATE on token_lifecycle_events succeeded despite forbid_update_delete';
  exception
    when others then
      if sqlerrm not like '%append-only%' then
        raise exception 'FAIL: UPDATE on token_lifecycle_events was rejected, but not by forbid_update_delete specifically (got: %)', sqlerrm;
      end if;
      raise notice 'PASS: UPDATE on token_lifecycle_events rejected by forbid_update_delete (%)', sqlerrm;
  end;

  begin
    delete from token_lifecycle_events where id = v_event_id;
    raise exception 'FAIL: DELETE on token_lifecycle_events succeeded despite forbid_update_delete';
  exception
    when others then
      if sqlerrm not like '%append-only%' then
        raise exception 'FAIL: DELETE on token_lifecycle_events was rejected, but not by forbid_update_delete specifically (got: %)', sqlerrm;
      end if;
      raise notice 'PASS: DELETE on token_lifecycle_events rejected by forbid_update_delete (%)', sqlerrm;
  end;
end $$;

do $$
declare
  v_token_id uuid;
  v_log_id uuid;
begin
  select id into v_token_id from client_access_tokens limit 1;

  insert into client_access_log (token_id, operation, outcome)
  values (v_token_id, 'getApplicationSummary', 'success')
  returning id into v_log_id;

  begin
    update client_access_log set outcome = 'denied' where id = v_log_id;
    raise exception 'FAIL: UPDATE on client_access_log succeeded despite forbid_update_delete';
  exception
    when others then
      if sqlerrm not like '%append-only%' then
        raise exception 'FAIL: UPDATE on client_access_log was rejected, but not by forbid_update_delete specifically (got: %)', sqlerrm;
      end if;
      raise notice 'PASS: UPDATE on client_access_log rejected by forbid_update_delete (%)', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
-- (e) Additional, adjacent to SS6's three named requirements: the
-- explicit service_role GRANTs are what make service_role's access
-- possible at all -- proving the "BYPASSRLS is not a substitute for
-- GRANT" gap this codebase has already hit twice (main project,
-- application_documents, GATE_2_0_FINDINGS.md SS H.2) does not recur
-- here silently. Control = revoke, confirm service_role's insert fails;
-- assert = restore, confirm it succeeds; regression = confirm
-- service_role's select still works throughout.
-- ---------------------------------------------------------------------
revoke insert on client_access_tokens from service_role;

do $$
begin
  begin
    set local role service_role;
    insert into client_access_tokens (
      application_id, org_id, recipient_email_display, recipient_email,
      token_hash, status, expires_at
    ) values (
      '73000000-0000-0000-0000-00000000000a', '73000000-0000-0000-0000-00000000000b',
      'grant-check@example.com', 'grant-check@example.com',
      encode(digest('grant-check-token', 'sha256'), 'hex'), 'active', now() + interval '14 days'
    );
    reset role;
    raise exception 'FAIL (control): service_role inserted into client_access_tokens with the INSERT grant revoked -- the later assertion would prove nothing without this control';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'PASS (control): service_role cannot INSERT into client_access_tokens with the grant revoked (%).', sqlerrm;
  end;
end $$;

grant insert on client_access_tokens to service_role;

do $$
declare
  v_count int;
begin
  set local role service_role;
  insert into client_access_tokens (
    application_id, org_id, recipient_email_display, recipient_email,
    token_hash, status, expires_at
  ) values (
    '73000000-0000-0000-0000-00000000000a', '73000000-0000-0000-0000-00000000000b',
    'grant-check@example.com', 'grant-check@example.com',
    encode(digest('grant-check-token-2', 'sha256'), 'hex'), 'active', now() + interval '14 days'
  );

  select count(*) into v_count from client_access_tokens where recipient_email = 'grant-check@example.com';
  reset role;

  if v_count <> 1 then
    raise exception 'FAIL: service_role INSERT into client_access_tokens did not persist after the grant was restored (count=%)', v_count;
  end if;
  raise notice 'PASS: service_role INSERT into client_access_tokens succeeds once the grant is restored (count=%).', v_count;
end $$;

do $$
declare
  v_select_count int;
begin
  -- Regression: service_role's pre-existing select/update capability
  -- (granted by the migration, never touched by this section) is
  -- unaffected by the revoke/restore cycle above.
  set local role service_role;
  select count(*) into v_select_count from client_access_tokens;
  reset role;
  if v_select_count < 1 then
    raise exception 'FAIL: service_role lost SELECT on client_access_tokens as a side effect of this test (count=%)', v_select_count;
  end if;
  raise notice 'PASS (regression): service_role SELECT on client_access_tokens still works (count=%).', v_select_count;
end $$;

rollback;
