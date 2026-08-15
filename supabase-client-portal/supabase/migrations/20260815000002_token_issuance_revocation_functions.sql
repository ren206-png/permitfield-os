-- Gate 2.0 sub-phase 2.6: staff-facing issuance/revocation, the atomic
-- transaction bodies (GATE_2_0_SPEC.md §1's "Issuance vs. the partial
-- unique index" section; scoped and reviewed in GATE_2_0_FINDINGS.md §O
-- before this branch, approved as "APPROVED: PHASE 2.6").
--
-- Why these are `security invoker` Postgres functions, not sequential
-- PostgREST calls from the TypeScript layer: §1's own issuance sequence
-- requires a `select ... for update` row lock and a conditional
-- update-then-insert inside ONE transaction (its own words: "Because
-- step 1's lock and step 2's transition happen in the same transaction as
-- step 3's insert, the partial unique index is never violated by a
-- legitimate re-issuance"). A `for update` lock has no meaning across
-- separate PostgREST calls -- each `.from(...).select()/.insert()/.update()`
-- is its own implicit transaction (the exact partial-write risk
-- `create_project_with_intake_atomic` (20260806000020) already fixed once
-- in the main project for the identical reason). Revocation gets the same
-- treatment for symmetry and because it too must pair a status UPDATE with
-- a token_lifecycle_events INSERT atomically, not as two independent
-- statements.
--
-- No `security definer` here (unlike `create_project_with_intake`, which
-- needs it to bypass RLS for an `authenticated` caller): this project has
-- no `authenticated` role and no RLS policy for any role but `service_role`
-- at all (20260814000001's own closing comment), and `service_role` already
-- has BYPASSRLS plus the explicit table grants these functions rely on.
-- Running as invoker (the caller's own already-privileged role) is
-- sufficient and keeps these functions from silently gaining privilege
-- they don't need.
--
-- Authorization itself (who is allowed to call this at all) is NOT this
-- function's job -- it happens one layer up, in project 1, via
-- can_issue_client_access_token()/can_revoke_client_access_token()
-- (20260806000033) before the staff-facing module ever reaches project 2.
-- This project has no org_members table to check membership against even
-- if it wanted to.
create or replace function issue_client_access_token(
  p_org_id uuid,
  p_application_id uuid,
  p_recipient_email_display text,
  p_recipient_name text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_triggered_by_org_user_id uuid
)
returns table (token_id uuid, expires_at timestamptz, was_created boolean)
language plpgsql
set search_path = public
as $$
declare
  v_recipient_email text := lower(btrim(p_recipient_email_display));
  v_existing record;
  v_terminal token_status;
  v_new_id uuid;
  v_constraint text;
begin
  -- §1 step 1: lock any existing active row for this recipient+application.
  -- Locks nothing on first issuance (nothing to lock yet) -- that gap is
  -- exactly what the exception handler below exists for.
  -- Table-qualified column refs below (client_access_tokens.expires_at,
  -- .org_id, .application_id throughout this file) are not stylistic --
  -- they're required. This function's own `returns table (token_id,
  -- expires_at, was_created)` clause makes `expires_at` a plpgsql OUT
  -- parameter/variable in scope for the whole function body, and this
  -- project's default plpgsql.variable_conflict = 'error' means any bare,
  -- unqualified `expires_at` column reference in a SQL command run from
  -- here raises "column reference \"expires_at\" is ambiguous" rather than
  -- silently picking one -- caught by lib/bridge/client-portal-admin.live.test.ts
  -- actually invoking this function for the first time (no prior test
  -- exercised it end to end; supabase/tests/*.test.sql only proves the
  -- authorization functions, not these).
  select id, client_access_tokens.expires_at into v_existing
  from client_access_tokens
  where recipient_email = v_recipient_email
    and application_id = p_application_id
    and status = 'active'
  for update;

  if found then
    -- §1 step 2: the true terminal state, not an assumption -- a row can
    -- read status='active' past its own expires_at (the lazy-expiry
    -- design), so this must re-derive which terminal state actually
    -- applies rather than always writing 'superseded'.
    v_terminal := case when v_existing.expires_at <= now() then 'expired' else 'superseded' end;

    update client_access_tokens
    set status = v_terminal
    where id = v_existing.id;

    insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_org_user_id, triggered_by_system)
    values (v_existing.id, 'active', v_terminal, p_triggered_by_org_user_id, false);
  end if;

  -- §1 step 3.
  insert into client_access_tokens (
    org_id, application_id, recipient_email_display, recipient_email,
    recipient_name, token_hash, status, expires_at
  )
  values (
    p_org_id, p_application_id, p_recipient_email_display, v_recipient_email,
    p_recipient_name, p_token_hash, 'active', p_expires_at
  )
  returning id into v_new_id;

  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_org_user_id, triggered_by_system)
  values (v_new_id, null, 'active', p_triggered_by_org_user_id, false);

  return query select v_new_id, p_expires_at, true;

exception
  when unique_violation then
    -- §1's own reasoning: on FIRST issuance to a recipient+application,
    -- step 1's lock has nothing to hold, so two concurrent first-issuance
    -- calls both reach the insert above and only one wins the partial
    -- unique index (client_access_tokens_one_active_per_recipient). Only
    -- swallow THAT specific constraint -- a collision on the unrelated
    -- `unique (token_hash)` constraint (cryptographically negligible, but
    -- not impossible to code defensively against) must not be silently
    -- reinterpreted as "someone else already issued this recipient a
    -- token," which would return the wrong row entirely.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'client_access_tokens_one_active_per_recipient' then
      raise;
    end if;

    -- Whatever earlier writes this invocation made in the `if found`
    -- branch above are already rolled back by plpgsql's own implicit
    -- savepoint for this exception block -- re-select is against a clean
    -- post-rollback view, not one this invocation half-mutated.
    select id, client_access_tokens.expires_at into v_existing
    from client_access_tokens
    where recipient_email = v_recipient_email
      and application_id = p_application_id
      and status = 'active';

    return query select v_existing.id, v_existing.expires_at, false;
end;
$$;

revoke all on function issue_client_access_token(uuid, uuid, text, text, text, timestamptz, uuid) from public;
grant execute on function issue_client_access_token(uuid, uuid, text, text, text, timestamptz, uuid) to service_role;

-- Per-token revocation path (§1: "UPDATE ... WHERE id = :token_id").
-- Empty result (no rows returned) means there was nothing to revoke --
-- already revoked/expired/superseded, the id doesn't exist, or (see
-- p_org_id below) it belongs to a different org -- not an error; the
-- caller (the staff-facing module) decides how to report that.
--
-- p_org_id is not optional scoping sugar: without it, a caller holding any
-- valid token_id (e.g. guessed, or leaked in a log line) could revoke a
-- token belonging to an org they were never authorized against -- the
-- staff-facing module's own authorization check
-- (can_revoke_client_access_token, project 1) only proves the caller may
-- revoke *something* in *their own* org, not that the specific token_id
-- they supplied is actually scoped to it. Filtering on org_id here closes
-- that gap at the same layer §3's read operations close the equivalent
-- gap for token-scoped reads ("no operation accepts an arbitrary
-- application_id/org_id parameter from the caller").
create or replace function revoke_client_access_token_by_id(
  p_token_id uuid,
  p_org_id uuid,
  p_triggered_by_org_user_id uuid
)
returns table (token_id uuid, org_id uuid, application_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_row record;
begin
  -- Table-qualified for the same reason as issue_client_access_token's own
  -- comment above: this function's `returns table (token_id, org_id,
  -- application_id)` makes org_id/application_id plpgsql OUT
  -- parameters, so bare references to those columns below are ambiguous
  -- under this project's default plpgsql.variable_conflict = 'error'.
  select id, client_access_tokens.org_id, client_access_tokens.application_id into v_row
  from client_access_tokens
  where id = p_token_id
    and client_access_tokens.org_id = p_org_id
    and status = 'active'
  for update;

  if not found then
    return;
  end if;

  update client_access_tokens
  set status = 'revoked',
      revoked_at = now(),
      revoked_by_org_user_id = p_triggered_by_org_user_id,
      revoked_by_system = false
  where id = v_row.id;

  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_org_user_id, triggered_by_system)
  values (v_row.id, 'active', 'revoked', p_triggered_by_org_user_id, false);

  return query select v_row.id, v_row.org_id, v_row.application_id;
end;
$$;

revoke all on function revoke_client_access_token_by_id(uuid, uuid, uuid) from public;
grant execute on function revoke_client_access_token_by_id(uuid, uuid, uuid) to service_role;

-- Per-recipient revocation path (§1: "UPDATE ... WHERE recipient_email = :email
-- AND application_id = :app_id AND status = 'active'", guaranteed to match
-- at most one row by client_access_tokens_one_active_per_recipient).
-- p_org_id scoping: same reasoning as revoke_client_access_token_by_id
-- above -- application_id alone already implies a single org via that
-- row's own org_id column, but this filters on it explicitly rather than
-- trusting the implication, matching this codebase's "the live re-check is
-- authoritative" discipline (lib/bridge/client-portal.ts's
-- loadScopedApplication()) instead of a join-implied one.
create or replace function revoke_client_access_token_for_recipient(
  p_application_id uuid,
  p_org_id uuid,
  p_recipient_email text,
  p_triggered_by_org_user_id uuid
)
returns table (token_id uuid, org_id uuid, application_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_row record;
  v_recipient_email text := lower(btrim(p_recipient_email));
begin
  -- Same ambiguity fix as revoke_client_access_token_by_id above.
  select id, client_access_tokens.org_id, client_access_tokens.application_id into v_row
  from client_access_tokens
  where client_access_tokens.application_id = p_application_id
    and client_access_tokens.org_id = p_org_id
    and recipient_email = v_recipient_email
    and status = 'active'
  for update;

  if not found then
    return;
  end if;

  update client_access_tokens
  set status = 'revoked',
      revoked_at = now(),
      revoked_by_org_user_id = p_triggered_by_org_user_id,
      revoked_by_system = false
  where id = v_row.id;

  insert into token_lifecycle_events (token_id, from_status, to_status, triggered_by_org_user_id, triggered_by_system)
  values (v_row.id, 'active', 'revoked', p_triggered_by_org_user_id, false);

  return query select v_row.id, v_row.org_id, v_row.application_id;
end;
$$;

revoke all on function revoke_client_access_token_for_recipient(uuid, uuid, text, uuid) from public;
grant execute on function revoke_client_access_token_for_recipient(uuid, uuid, text, uuid) to service_role;
