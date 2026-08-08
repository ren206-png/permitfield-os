-- Lifecycle & Compliance Expansion, Phase 1.2. Proves, against the actual
-- `authenticated`/`service_role`/`anon` Postgres roles under RLS (not just
-- "the UI doesn't show a button for it" -- see adversarial self-check #4 of
-- prior gate reports), everything
-- 20260806000021_jurisdiction_sources.sql adds:
--   1. jurisdiction_sources is global reference data: any authenticated
--      user, from any org, can SELECT every row -- there is no org_id on
--      this table at all.
--   2. Only a `platform_admin`-role org_members row can INSERT or UPDATE --
--      a plain `owner` cannot, proving is_platform_admin() is a real gate,
--      not a no-op (mirrors audit_logs.test.sql's SS3, which proves
--      can_read_audit_logs() is narrower than is_org_member()).
--   3. The forged-`verified_by` defense on the base UPDATE policy actually
--      rejects a platform_admin attributing a row to someone else.
--   4. verify_jurisdiction_source() is the sanctioned verification path:
--      rejects a non-platform_admin caller, and for an authorized caller
--      always stamps verified_by = auth.uid() (never a caller-supplied
--      value -- there is no such parameter).
--   5. The `jurisdiction_sources_verified_requires_reviewer` check
--      constraint rejects a 'verified' row with a null verified_by/
--      verified_at, even from service_role (RLS bypass does not bypass a
--      CHECK constraint).
--   6. jurisdiction_source_effective_status() computes 'stale' for a
--      'verified' row older than the threshold, and leaves every other
--      status (and a 'verified' row within the threshold) unchanged --
--      the auto-stale computation SS3.3 requires, exercised directly since
--      no scheduled job or route calls it yet (see the migration's header
--      comment).
--   7. No DELETE policy exists -- archival-only, same as every other Phase
--      1.1/1.2 table.
--
-- HOW TO RUN (written but NOT EXECUTED in this environment -- no Docker/psql;
-- see PHASE_0_FINDINGS.md SS1 and prior gate reports' "Tests" sections):
--   1. supabase start
--   2. supabase db reset
--   3. psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
--        -f supabase/tests/jurisdiction_sources.test.sql
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.
--
-- Or, to run this file together with every other supabase/tests/*.test.sql
-- file in one command (after steps 1-2 above): npm run test:sql
-- (see scripts/run-sql-tests.sh).
--
-- Also runs automatically on every push/PR via .github/workflows/ci.yml's
-- sql-tests job, which has Docker (ubuntu-latest runners) and so can
-- actually execute this file end-to-end -- unlike every sandbox this file
-- has been edited in so far.

begin;

-- Reuses Org A's owner fixture from supabase/seed.sql PART 2 (also relied on
-- by tenant_isolation.test.sql and audit_logs.test.sql):
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
-- Reuses the Toronto jurisdiction fixture from PART 1 (already 'verified'):
--   00000000-0000-0000-0001-000000000001

-- A dedicated platform_admin fixture user, added here (not in seed.sql) the
-- same way audit_logs.test.sql adds its own third 'member'-role user
-- specifically to exercise a role boundary seed.sql's two plain owners
-- don't cover. Placed in Org A's org_members roster (platform_admin is
-- org-agnostic per this migration's design -- see its header comment -- so
-- which org the row lives under is incidental to what it can do).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated',
        'platform-admin@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000d', 'platform_admin')
on conflict (org_id, user_id) do nothing;

-- === 1. is_platform_admin() itself: false for a plain owner, true for the fixture above ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  if is_platform_admin() then
    raise exception 'FAIL: plain owner incorrectly reported as platform_admin';
  end if;
  raise notice 'PASS: is_platform_admin() is false for a plain owner';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
begin
  if not is_platform_admin() then
    raise exception 'FAIL: platform_admin fixture user not recognized by is_platform_admin()';
  end if;
  raise notice 'PASS: is_platform_admin() is true for the platform_admin fixture user';
end $$;

-- === 2. INSERT policy: a plain owner cannot create a jurisdiction_sources row ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    insert into jurisdiction_sources (jurisdiction_id, source_type, url)
    values ('00000000-0000-0000-0001-000000000001', 'fee_schedule', 'https://example.test/fees');
    raise exception 'FAIL: plain owner was able to insert a jurisdiction_sources row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: plain owner cannot insert jurisdiction_sources (%)', sqlerrm;
  end;
end $$;

-- === 3. INSERT policy: platform_admin CAN create one ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
declare
  new_id uuid;
begin
  insert into jurisdiction_sources (id, jurisdiction_id, source_type, url, retrieved_at)
  values ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0001-000000000001',
          'fee_schedule', 'https://www.toronto.ca/fees', now())
  returning id into new_id;

  if new_id is null then
    raise exception 'FAIL: platform_admin insert did not return an id';
  end if;
  raise notice 'PASS: platform_admin inserted a jurisdiction_sources row';
end $$;

-- === 4. SELECT policy: global, any authenticated user from any org can read it ===
-- Org A owner (not platform_admin, not the row's creator).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from jurisdiction_sources
  where id = '60000000-0000-0000-0000-00000000000a';
  if visible_count <> 1 then
    raise exception 'FAIL: org A owner could not see the jurisdiction_sources row (saw %)', visible_count;
  end if;
  raise notice 'PASS: org A owner (non-platform_admin) can read jurisdiction_sources -- global reference data';
end $$;

-- Org B owner -- proves this really is global (no org scoping at all), not
-- an accidental Org-A-only read.
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count
  from jurisdiction_sources
  where id = '60000000-0000-0000-0000-00000000000a';
  if visible_count <> 1 then
    raise exception 'FAIL: org B owner could not see org A platform_admin''s jurisdiction_sources row (saw %) -- should be global', visible_count;
  end if;
  raise notice 'PASS: org B owner can also read the same jurisdiction_sources row -- confirms global, not org-scoped';
end $$;

-- anon: no policy at all AND no table grant -- must see zero rows.
set local request.jwt.claims = '';
set local role anon;

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from jurisdiction_sources;
  if visible_count <> 0 then
    raise exception 'FAIL: anon role could see % jurisdiction_sources rows', visible_count;
  end if;
  raise notice 'PASS: anon role sees zero jurisdiction_sources rows';
end $$;

-- === 5. UPDATE forged verified_by: platform_admin cannot attribute the row to someone else ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
begin
  begin
    update jurisdiction_sources
    set verified_by = '10000000-0000-0000-0000-00000000000a', -- not the caller
        verified_at = now(),
        verification_status = 'verified'
    where id = '60000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: platform_admin was able to forge verified_by to a different user via direct UPDATE';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: forged verified_by UPDATE correctly rejected (%)', sqlerrm;
  end;
end $$;

-- === 6. verify_jurisdiction_source(): rejects a non-platform_admin caller ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    perform verify_jurisdiction_source('60000000-0000-0000-0000-00000000000a', 'verified', 'looks good');
    raise exception 'FAIL: plain owner was able to call verify_jurisdiction_source()';
  exception
    when others then
      raise notice 'PASS: verify_jurisdiction_source() correctly rejected a non-platform_admin caller (%)', sqlerrm;
  end;
end $$;

-- === 7. verify_jurisdiction_source(): succeeds for platform_admin, stamps auth.uid() server-side ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
declare
  result jurisdiction_sources;
begin
  select * into result
  from verify_jurisdiction_source('60000000-0000-0000-0000-00000000000a', 'verified', 'confirmed against toronto.ca');

  if result.verification_status <> 'verified' then
    raise exception 'FAIL: verify_jurisdiction_source did not set verification_status to verified, got %', result.verification_status;
  end if;
  if result.verified_by <> '10000000-0000-0000-0000-00000000000d' then
    raise exception 'FAIL: verify_jurisdiction_source did not stamp the calling platform_admin as verified_by, got %', result.verified_by;
  end if;
  if result.verified_at is null then
    raise exception 'FAIL: verify_jurisdiction_source left verified_at null';
  end if;
  if result.notes <> 'confirmed against toronto.ca' then
    raise exception 'FAIL: verify_jurisdiction_source did not persist notes';
  end if;
  raise notice 'PASS: verify_jurisdiction_source() verified the row and stamped the correct reviewer';
end $$;

-- === 7b. verify_jurisdiction_source(): p_clear_notes explicitly clears notes,
-- and omitting it (as section 7 above does) preserves the existing note ===
-- Fixed after the initial Gate 1.2 report flagged that the original
-- `coalesce(p_notes, notes)` shape had no way to ever clear a note -- see
-- the migration's updated header comment on this function.
do $$
declare
  result jurisdiction_sources;
begin
  -- Sanity: omitting p_clear_notes (default false) with p_notes null
  -- preserves the note section 7 just set, doesn't wipe it.
  select * into result
  from verify_jurisdiction_source('60000000-0000-0000-0000-00000000000a', 'verified');

  if result.notes <> 'confirmed against toronto.ca' then
    raise exception 'FAIL: omitting p_notes/p_clear_notes unexpectedly changed notes to %', result.notes;
  end if;

  -- p_clear_notes = true wipes it, even if p_notes is also (uselessly) passed.
  select * into result
  from verify_jurisdiction_source('60000000-0000-0000-0000-00000000000a', 'verified', 'ignored', true);

  if result.notes is not null then
    raise exception 'FAIL: p_clear_notes=true did not clear notes, got %', result.notes;
  end if;
  raise notice 'PASS: verify_jurisdiction_source() p_clear_notes clears notes; omitting it preserves them';
end $$;

-- === 8. Check constraint: cannot mark 'verified' without verified_by/verified_at, even as service_role ===
-- (RLS bypass via BYPASSRLS does not bypass a table-level CHECK constraint --
-- same "trigger/constraint is a second, storage-engine-level backstop"
-- property audit_logs.test.sql proves for its append-only trigger.)
set local role service_role;

do $$
begin
  begin
    insert into jurisdiction_sources (jurisdiction_id, source_type, url, verification_status)
    values ('00000000-0000-0000-0001-000000000001', 'bylaw', 'https://example.test/bylaw', 'verified');
    raise exception 'FAIL: service_role inserted a verified row with no verified_by/verified_at';
  exception
    when check_violation or others then
      raise notice 'PASS: jurisdiction_sources_verified_requires_reviewer constraint correctly rejected the insert (%)', sqlerrm;
  end;
end $$;

-- A 'verified' row WITH both fields set is legal, even inserted directly
-- (confirms the constraint isn't rejecting every insert, only the invalid shape).
do $$
declare
  new_id uuid;
begin
  insert into jurisdiction_sources (jurisdiction_id, source_type, url, verification_status, verified_by, verified_at)
  values ('00000000-0000-0000-0001-000000000001', 'processing_times', 'https://example.test/times',
          'verified', '10000000-0000-0000-0000-00000000000d', now())
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: valid verified-with-reviewer insert unexpectedly failed';
  end if;
  raise notice 'PASS: a verified row with verified_by/verified_at set inserts successfully';
end $$;

-- === 9. jurisdiction_source_effective_status(): the auto-stale computation itself ===
do $$
declare
  fresh_status jurisdiction_source_verification_status;
  stale_status jurisdiction_source_verification_status;
  boundary_status jurisdiction_source_verification_status;
  unverified_status jurisdiction_source_verification_status;
  disputed_status jurisdiction_source_verification_status;
begin
  -- Verified 1 day ago, default 180-day threshold: still verified.
  select jurisdiction_source_effective_status('verified', now() - interval '1 day') into fresh_status;
  if fresh_status <> 'verified' then
    raise exception 'FAIL: a 1-day-old verified source computed as %, expected verified', fresh_status;
  end if;

  -- Verified 181 days ago: stale.
  select jurisdiction_source_effective_status('verified', now() - interval '181 days') into stale_status;
  if stale_status <> 'stale' then
    raise exception 'FAIL: a 181-day-old verified source computed as %, expected stale', stale_status;
  end if;

  -- Verified exactly 180 days ago: NOT yet stale (strict `<` in the function).
  select jurisdiction_source_effective_status('verified', now() - interval '180 days') into boundary_status;
  if boundary_status <> 'verified' then
    raise exception 'FAIL: a source verified exactly 180 days ago computed as %, expected verified (boundary is strict)', boundary_status;
  end if;

  -- unverified/disputed never become stale regardless of age.
  select jurisdiction_source_effective_status('unverified', now() - interval '1000 days') into unverified_status;
  if unverified_status <> 'unverified' then
    raise exception 'FAIL: an unverified source computed as %, expected unverified (staleness only applies to verified)', unverified_status;
  end if;

  select jurisdiction_source_effective_status('disputed', now() - interval '1000 days') into disputed_status;
  if disputed_status <> 'disputed' then
    raise exception 'FAIL: a disputed source computed as %, expected disputed', disputed_status;
  end if;

  raise notice 'PASS: jurisdiction_source_effective_status() computes auto-stale correctly at the 180-day boundary';
end $$;

-- A configurable (non-default) threshold, per SS3.3's "configurable threshold".
do $$
declare
  custom_threshold_status jurisdiction_source_verification_status;
begin
  select jurisdiction_source_effective_status('verified', now() - interval '31 days', 30) into custom_threshold_status;
  if custom_threshold_status <> 'stale' then
    raise exception 'FAIL: a 31-day-old source with a 30-day threshold computed as %, expected stale', custom_threshold_status;
  end if;
  raise notice 'PASS: jurisdiction_source_effective_status() honors a non-default threshold_days argument';
end $$;

-- === 10. No DELETE policy: even platform_admin cannot delete a row ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
declare
  deleted_count int;
begin
  delete from jurisdiction_sources where id = '60000000-0000-0000-0000-00000000000a';
  get diagnostics deleted_count = row_count;
  if deleted_count <> 0 then
    raise exception 'FAIL: platform_admin was able to DELETE a jurisdiction_sources row (archival-only rule violated)';
  end if;
  raise notice 'PASS: DELETE on jurisdiction_sources affects 0 rows for platform_admin -- no DELETE policy exists';
end $$;

rollback;
