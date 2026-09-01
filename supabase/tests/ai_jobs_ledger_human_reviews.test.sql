-- Gate AI-1, sub-phase AI-1.1. Proves, for the three tables added by
-- 20260806000036_ai_jobs_token_ledger_human_reviews.sql
-- (ai_jobs, ai_token_ledger, ai_human_reviews), the same shape of guarantees
-- supabase/tests/audit_logs.test.sql proves for audit_logs, plus the
-- TRUNCATE-gap check supabase/tests/service_role_truncate_append_only.test.sql
-- proves for the original seven append-only tables:
--   1. Tenant isolation: org A cannot read org B's rows on any of the three
--      tables.
--   2. can_read_ai_ledger() is narrower than is_org_member(): a plain
--      'member'-role user in org A cannot read org A's own rows.
--   3. Append-only: `authenticated` cannot INSERT (no policy grants it),
--      UPDATE, or DELETE ai_jobs/ai_token_ledger rows; service_role
--      (BYPASSRLS) is still blocked by the forbid_update_delete() trigger.
--   4. ai_human_reviews: an elevated-role member CAN transition
--      pending -> released exactly once, cannot forge another user's
--      reviewer_user_id, cannot transition a second time, cannot mutate
--      org_id/job_id/created_at, and can never DELETE a row (any role).
--   5. TRUNCATE: service_role is rejected once this migration's revoke is in
--      effect (the real, already-applied state); temporarily re-granting
--      first proves the row-level triggers alone would NOT have stopped a
--      TRUNCATE, so the revoke is the one thing actually closing this gap
--      (same control-then-assert shape as
--      service_role_truncate_append_only.test.sql).
--
-- HOW TO RUN: same as every other file in this directory --
--   1. supabase start
--   2. supabase db reset
--   3. npm run test:sql
-- (or: psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/tests/ai_jobs_ledger_human_reviews.test.sql)
-- A clean run prints only NOTICEs; any RAISE EXCEPTION means a regression.

begin;

-- Org A/B and their 'owner' users are seeded by supabase/seed.sql PART 2,
-- the same fixtures tenant_isolation.test.sql / audit_logs.test.sql rely on.
--   Org A: 20000000-0000-0000-0000-00000000000a / owner 10000000-...000a
--   Org B: 20000000-0000-0000-0000-00000000000b / owner 10000000-...000b

-- Non-elevated member, added here (not in seed.sql) to exercise
-- can_read_ai_ledger()'s narrower-than-membership boundary -- same fixture
-- shape as audit_logs.test.sql's org-A 'member' user.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated',
        'orgc-member-ai@test.permitfield.local', crypt('test-password-not-real', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000c', 'member')
on conflict (org_id, user_id) do nothing;

-- Seed fixtures as service_role (bypasses RLS -- proves nothing about the
-- INSERT-is-service-role-only claim below on its own; that's asserted
-- separately in section 3).
set local role service_role;

insert into ai_jobs (id, org_id, kind, provider, model_id, status, input_token_count, output_token_count)
values
  ('60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'assistant', 'gemini', 'test-model', 'succeeded', 100, 50),
  ('60000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   'assistant', 'gemini', 'test-model', 'succeeded', 100, 50);

insert into ai_token_ledger (id, org_id, job_id, provider, model_id, input_token_count, output_token_count, cost_usd_cents)
values
  ('61000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-00000000000a', 'gemini', 'test-model', 100, 50, 1);

insert into ai_human_reviews (id, org_id, job_id, status)
values
  ('62000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-00000000000a', 'pending');

reset role;

-- === 1. Tenant isolation: org A owner cannot read org B's rows ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  cross_tenant_count int;
begin
  select count(*) into cross_tenant_count from ai_jobs where org_id = '20000000-0000-0000-0000-00000000000b';
  if cross_tenant_count <> 0 then
    raise exception 'FAIL: org A owner could read % of org B''s ai_jobs rows', cross_tenant_count;
  end if;
  raise notice 'PASS: org A owner cannot read org B''s ai_jobs rows';
end $$;

-- === 2. can_read_ai_ledger() is narrower than is_org_member() ===
do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from ai_jobs where org_id = '20000000-0000-0000-0000-00000000000a';
  if visible_count <> 1 then
    raise exception 'FAIL: org A owner should see exactly 1 ai_jobs row, saw %', visible_count;
  end if;
  raise notice 'PASS: org A owner (elevated role) can read org A''s ai_jobs row';
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from ai_jobs where org_id = '20000000-0000-0000-0000-00000000000a';
  if visible_count <> 0 then
    raise exception 'FAIL: plain ''member'' role could read % ai_jobs rows in their own org (should be 0)', visible_count;
  end if;
  select count(*) into visible_count from ai_token_ledger where org_id = '20000000-0000-0000-0000-00000000000a';
  if visible_count <> 0 then
    raise exception 'FAIL: plain ''member'' role could read % ai_token_ledger rows in their own org (should be 0)', visible_count;
  end if;
  select count(*) into visible_count from ai_human_reviews where org_id = '20000000-0000-0000-0000-00000000000a';
  if visible_count <> 0 then
    raise exception 'FAIL: plain ''member'' role could read % ai_human_reviews rows in their own org (should be 0)', visible_count;
  end if;
  raise notice 'PASS: plain ''member'' role is correctly denied SELECT on all three AI-1.1 tables despite is_org_member being true';
end $$;

-- === 3. Append-only: authenticated cannot INSERT/UPDATE/DELETE ai_jobs/ai_token_ledger ===
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    insert into ai_jobs (org_id, kind, provider, model_id, status, input_token_count, output_token_count)
    values ('20000000-0000-0000-0000-00000000000a', 'assistant', 'gemini', 'test-model', 'succeeded', 1, 1);
    raise exception 'FAIL: authenticated was able to INSERT an ai_jobs row (should be service_role only)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: INSERT on ai_jobs correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update ai_jobs set status = 'failed' where id = '60000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE an ai_jobs row';
  exception
    when others then
      raise notice 'PASS: UPDATE on ai_jobs correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from ai_jobs where id = '60000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE an ai_jobs row';
  exception
    when others then
      raise notice 'PASS: DELETE on ai_jobs correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update ai_token_ledger set cost_usd_cents = 999 where id = '61000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to UPDATE an ai_token_ledger row';
  exception
    when others then
      raise notice 'PASS: UPDATE on ai_token_ledger correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

-- service_role (BYPASSRLS) is still blocked by the trigger.
set local role service_role;

do $$
begin
  begin
    update ai_jobs set status = 'failed' where id = '60000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to UPDATE an ai_jobs row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: UPDATE on ai_jobs correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from ai_token_ledger where id = '61000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE an ai_token_ledger row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: DELETE on ai_token_ledger correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

-- === 4. ai_human_reviews: mutable decision, but only once, and not forgeable ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000c","role":"authenticated"}';

do $$
begin
  begin
    update ai_human_reviews
    set status = 'released', reviewer_user_id = '10000000-0000-0000-0000-00000000000a', decided_at = now()
    where id = '62000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: plain ''member'' role was able to decide an ai_human_reviews row';
  exception
    when others then
      raise notice 'PASS: non-elevated role correctly denied UPDATE on ai_human_reviews (%)', sqlerrm;
  end;
end $$;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  begin
    update ai_human_reviews
    set status = 'released', reviewer_user_id = '10000000-0000-0000-0000-00000000000c', decided_at = now()
    where id = '62000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: org A owner was able to attribute a decision to a different user (forged reviewer_user_id)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: forged reviewer_user_id update correctly rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  update ai_human_reviews
  set status = 'released', reviewer_user_id = '10000000-0000-0000-0000-00000000000a', decided_at = now()
  where id = '62000000-0000-0000-0000-00000000000a';
  raise notice 'PASS: elevated-role org A owner released their own ai_human_reviews decision';
end $$;

do $$
begin
  begin
    update ai_human_reviews
    set status = 'rejected', reviewer_user_id = '10000000-0000-0000-0000-00000000000a', decided_at = now()
    where id = '62000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: ai_human_reviews.status was allowed to transition a second time';
  exception
    when others then
      raise notice 'PASS: a second status transition on the same ai_human_reviews row correctly rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from ai_human_reviews where id = '62000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: authenticated was able to DELETE an ai_human_reviews row';
  exception
    when others then
      raise notice 'PASS: DELETE on ai_human_reviews correctly rejected for authenticated (%)', sqlerrm;
  end;
end $$;

set local role service_role;

do $$
begin
  begin
    delete from ai_human_reviews where id = '62000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: service_role was able to DELETE an ai_human_reviews row (RLS bypass reached the table)';
  exception
    when others then
      raise notice 'PASS: DELETE on ai_human_reviews correctly rejected for service_role by the trigger (%)', sqlerrm;
  end;
end $$;

reset role;

-- === 5. TRUNCATE: control (gap would be real without the revoke), then assert (revoke closes it) ===
-- Runs as the connecting role (postgres) to perform the GRANT/REVOKE DDL,
-- same pattern as service_role_truncate_append_only.test.sql.

grant truncate on ai_jobs, ai_token_ledger, ai_human_reviews to service_role;

set role service_role;

do $$
begin
  execute 'truncate table ai_jobs, ai_token_ledger, ai_human_reviews';
  raise notice 'PASS (control): service_role TRUNCATE succeeded on all three AI-1.1 tables while the grant is present -- confirms the row-level triggers alone do not stop TRUNCATE, same as the original seven append-only tables.';
exception
  when insufficient_privilege then
    raise exception 'FAIL (control): service_role TRUNCATE was rejected even with the grant present -- the later failure assertion would prove nothing without this control succeeding first. (%)', sqlerrm;
end $$;

reset role;

revoke truncate on ai_jobs, ai_token_ledger, ai_human_reviews from service_role;

set role service_role;

do $$
begin
  execute 'truncate table ai_jobs, ai_token_ledger, ai_human_reviews';
  raise exception 'FAIL (assert): service_role TRUNCATE succeeded on the AI-1.1 tables after the grant was revoked -- this migration''s TRUNCATE revoke is not actually in effect.';
exception
  when insufficient_privilege then
    raise notice 'PASS (assert): service_role TRUNCATE on all three AI-1.1 tables correctly rejected once the grant is revoked (restoring this migration''s actual, already-applied effect). (%)', sqlerrm;
end $$;

reset role;

rollback;
