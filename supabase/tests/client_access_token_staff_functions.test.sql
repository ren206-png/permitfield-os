-- Gate 2.0 sub-phase 2.6 (GATE_2_0_SPEC.md §7 item 2; scoped/approved in
-- GATE_2_0_FINDINGS.md §O as "APPROVED: PHASE 2.6"). Proves
-- can_issue_client_access_token() and can_revoke_client_access_token()
-- (20260806000033_client_access_token_staff_functions.sql) admit and refuse
-- exactly the role tiers that migration's header comment specifies:
--
--   can_issue_client_access_token(org_id)  -> owner, org_owner
--   can_revoke_client_access_token(org_id) -> owner, org_owner, permit_manager
--
-- The asymmetric case is the point of this file (explicit instruction in the
-- 2.6 approval message: "Prove each role tier is admitted or refused on the
-- correct operation -- including that permit_manager can revoke and cannot
-- issue"): §5's PART 3 below is a single do $$ block that checks BOTH
-- functions for the same permit_manager fixture user and fails loudly if
-- either half of that asymmetry doesn't hold.
--
-- Also proves check_org_id actually scopes the check (not just role,
-- otherwise any org member anywhere could pass by naming a foreign org_id):
-- PART 5 has Org B's owner call both functions against Org A's org_id and
-- requires both to return false, even though that user legitimately holds
-- 'owner' -- just not in the org being asked about.
--
-- Both functions are plain `security definer` SQL functions returning
-- boolean, not RLS policies, so this file calls them directly as `select
-- can_issue_client_access_token(...)` under each fixture user's JWT rather
-- than probing table access indirectly -- there's no table to probe; the
-- table-level enforcement these gate (client_access_tokens, project 2) lives
-- in a different Supabase project entirely and is proven by
-- lib/bridge/client-portal-admin.live.test.ts instead (see that file for the
-- 23505-race and revocation-path proofs; this file is SQL-authorization-only,
-- mirroring the audit_logs.test.sql / permit_requirements_engine.test.sql
-- convention of one begin/rollback transaction per file).
--
-- HOW TO RUN: see supabase/tests/audit_logs.test.sql's header for the full
-- supabase start / db reset / psql invocation, or `npm run test:sql` to run
-- every supabase/tests/*.test.sql file in one command. Also runs on every
-- push/PR via .github/workflows/ci.yml's sql-tests job.

begin;

-- Org A/B and their 'owner' users are seeded by supabase/seed.sql PART 2:
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b

-- Dedicated org_owner/permit_manager/member fixture users for Org A, same
-- pattern as permit_requirements_engine.test.sql's 060/061 (distinct literal
-- ids -- each test file runs in its own begin/rollback transaction via its
-- own psql -f invocation, so collisions are harmless either way, but keeping
-- them distinct makes error output unambiguous about which file a fixture
-- belongs to).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000080', 'authenticated', 'authenticated',
   'catf-org-owner@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000081', 'authenticated', 'authenticated',
   'catf-permit-manager@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000082', 'authenticated', 'authenticated',
   'catf-member@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000080', 'org_owner'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000081', 'permit_manager'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000082', 'member')
on conflict (org_id, user_id) do nothing;

-- === 1. 'owner' (Org A's seeded owner) is admitted by both functions ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  if not can_issue_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: owner was refused can_issue_client_access_token';
  end if;
  if not can_revoke_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: owner was refused can_revoke_client_access_token';
  end if;
  raise notice 'PASS: owner is admitted by both can_issue_client_access_token and can_revoke_client_access_token';
end $$;

-- === 2. 'org_owner' is admitted by both functions ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000080","role":"authenticated"}';

do $$
begin
  if not can_issue_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: org_owner was refused can_issue_client_access_token';
  end if;
  if not can_revoke_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: org_owner was refused can_revoke_client_access_token';
  end if;
  raise notice 'PASS: org_owner is admitted by both can_issue_client_access_token and can_revoke_client_access_token';
end $$;

-- === 3. THE asymmetric case: permit_manager can revoke, cannot issue ===
-- This is the specific proof the 2.6 approval message called out by name.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000081","role":"authenticated"}';

do $$
begin
  if can_issue_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: permit_manager was admitted by can_issue_client_access_token (must be refused -- issuance is owner/org_owner only)';
  end if;
  if not can_revoke_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: permit_manager was refused can_revoke_client_access_token (must be admitted)';
  end if;
  raise notice 'PASS: permit_manager is refused can_issue_client_access_token and admitted by can_revoke_client_access_token (the asymmetric case)';
end $$;

-- === 4. Plain 'member' is refused by both functions ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000082","role":"authenticated"}';

do $$
begin
  if can_issue_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: plain member was admitted by can_issue_client_access_token';
  end if;
  if can_revoke_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: plain member was admitted by can_revoke_client_access_token';
  end if;
  raise notice 'PASS: plain member is refused by both can_issue_client_access_token and can_revoke_client_access_token';
end $$;

-- === 5. check_org_id actually scopes the check, not just role ===
-- Org B's seeded owner legitimately holds 'owner' -- but not in Org A. Both
-- functions must refuse them when asked about Org A's org_id, proving the
-- check isn't "does this caller hold an admitted role anywhere".
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
begin
  if can_issue_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: Org B owner was admitted by can_issue_client_access_token for Org A''s org_id';
  end if;
  if can_revoke_client_access_token('20000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: Org B owner was admitted by can_revoke_client_access_token for Org A''s org_id';
  end if;
  raise notice 'PASS: Org B owner is refused both functions when asked about Org A''s org_id (check_org_id is enforced, not just role)';
end $$;

-- Sanity check: Org B's owner IS admitted for their OWN org, confirming the
-- refusal above is about org scoping and not some other reason (e.g. a typo
-- in the fixture role) making 'owner' always fail.
do $$
begin
  if not can_issue_client_access_token('20000000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: Org B owner was refused can_issue_client_access_token for their OWN org_id (sanity check)';
  end if;
  if not can_revoke_client_access_token('20000000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: Org B owner was refused can_revoke_client_access_token for their OWN org_id (sanity check)';
  end if;
  raise notice 'PASS: Org B owner is admitted by both functions for their own org_id (sanity check confirming PART 5''s refusals are about org scoping)';
end $$;

rollback;
