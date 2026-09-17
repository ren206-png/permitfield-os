-- Gate 4 (Quotes & Payments), Phase A, migration 3 of 7: estimate
-- acceptances -- the customer-facing "I accept this quote" action.
--
-- Actor shape: unlike estimates/estimate_line_items (written by staff, an
-- `authenticated` session with a real org membership), an acceptance is
-- performed by an external customer with NO Supabase Auth session in this
-- project at all -- the same actor shape audit_logs' external-actor CHECK
-- (20260806000030) and client_access_tokens (supabase-client-portal
-- project) already model. There is no `auth.uid()` to check org membership
-- against here, so this table follows client_access_tokens' own precedent
-- exactly: no RLS policy exists for `authenticated` INSERT at all (only
-- SELECT, so org staff can see who accepted what), and the only writer is
-- `record_estimate_acceptance()` below, executed by `service_role` (the
-- future lib/bridge/client-portal.ts-style gateway module for this gate,
-- not built in this pass) -- never by an end-user session.
--
-- Minimal technical evidence only (master prompt: "only the minimal
-- justified technical evidence") -- `ip`/`user_agent`, nothing more. No
-- device fingerprinting, no geolocation, no session-replay data.
--
-- "A new revision invalidates any stale acceptance action" (this gate's
-- explicit requirement) is enforced two ways, deliberately redundant:
--   1. A partial-unique-index-shaped guarantee via the plain `unique
--      (revision_id)` constraint below -- one acceptance per revision,
--      full stop (a revision that already has an acceptance can never get
--      a second one, stale or not).
--   2. record_estimate_acceptance() (below) re-checks, INSIDE the same
--      transaction as the insert, that `p_revision_id` is still the
--      estimate's `current_revision_id` at the moment of acceptance --
--      closing the actual race this requirement describes: a customer who
--      opened an old email link to revision 1 while staff had already sent
--      revision 2 must not be able to accept revision 1, even though
--      revision 1 itself never had a prior acceptance and so would pass
--      check #1 alone. This is an application-level check enforced INSIDE
--      a SECURITY DEFINER RPC (not a bare CHECK constraint, since it needs
--      a live join back to `estimates.current_revision_id`, which a CHECK
--      cannot express against a different, mutable table) -- the cleanest
--      DB-layer option available for a cross-table invariant that isn't
--      expressible as a single-table constraint.
create table estimate_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  estimate_id uuid not null,
  revision_id uuid not null references estimate_revisions (id),
  -- Exact revision hash accepted -- a content hash of the revision's
  -- immutable fields (line_items/totals/scope text), computed by the
  -- caller at accept time and stored verbatim, giving a second, independent
  -- way to prove "this is exactly what was accepted" even if the FK target
  -- row's own columns were ever inspected out of context. Not computed in
  -- SQL (no pgcrypto digest() call here) -- the future bridge layer computes
  -- this the same way it would compute any other content hash, kept in one
  -- place rather than duplicated as a generated column.
  revision_hash text not null,
  accepted_scope_snapshot jsonb not null,
  typed_name text not null,
  claimed_authority text not null,
  ip inet,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (revision_id),
  foreign key (org_id, estimate_id) references estimates (org_id, id)
);

create index estimate_acceptances_estimate_id_idx on estimate_acceptances (org_id, estimate_id);

alter table estimate_acceptances enable row level security;

create policy estimate_acceptances_select on estimate_acceptances
  for select to authenticated
  using (is_org_member(org_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` at all -- see this
-- migration's header comment. Append-only backstop regardless (defeats
-- service_role's BYPASSRLS too, same reuse as every other immutable table
-- in this schema).
create trigger estimate_acceptances_append_only
  before update or delete on estimate_acceptances
  for each row execute function forbid_update_delete();

grant select on estimate_acceptances to authenticated;
grant select, insert on estimate_acceptances to service_role;

-- record_estimate_acceptance(): the sole sanctioned write path. Deliberately
-- NOT gated by is_org_member()/auth.uid() (there is no session to check --
-- see header comment); the only privilege boundary that matters is the
-- function-execute grant itself, restricted to service_role below. Runs
-- SECURITY DEFINER purely to centralize the "check current + insert" logic
-- as one atomic, reusable unit -- service_role already bypasses RLS on its
-- own, so this is not a privilege-elevation mechanism here, just a shared
-- entry point every future caller (the bridge layer) uses identically.
create or replace function record_estimate_acceptance(
  p_revision_id uuid,
  p_revision_hash text,
  p_accepted_scope_snapshot jsonb,
  p_typed_name text,
  p_claimed_authority text,
  p_ip inet default null,
  p_user_agent text default null
)
returns estimate_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rev estimate_revisions;
  v_est estimates;
  v_acceptance estimate_acceptances;
begin
  select * into v_rev from estimate_revisions where id = p_revision_id;
  if v_rev.id is null then
    raise exception 'estimate_revision % not found', p_revision_id;
  end if;

  select * into v_est from estimates where id = v_rev.estimate_id for update;
  if v_est.id is null then
    raise exception 'estimate % not found for revision %', v_rev.estimate_id, p_revision_id;
  end if;

  -- The stale-revision guard: see this migration's header comment, point 2.
  if v_est.current_revision_id is distinct from p_revision_id then
    raise exception 'stale_revision: revision % is no longer the current revision for estimate % (current is %)',
      p_revision_id, v_est.id, v_est.current_revision_id
      using errcode = '22023';
  end if;

  if p_typed_name is null or btrim(p_typed_name) = '' then
    raise exception 'typed_name is required';
  end if;
  if p_claimed_authority is null or btrim(p_claimed_authority) = '' then
    raise exception 'claimed_authority is required';
  end if;

  insert into estimate_acceptances (
    org_id, estimate_id, revision_id, revision_hash, accepted_scope_snapshot,
    typed_name, claimed_authority, ip, user_agent
  ) values (
    v_est.org_id, v_est.id, p_revision_id, p_revision_hash, p_accepted_scope_snapshot,
    p_typed_name, p_claimed_authority, p_ip, p_user_agent
  )
  returning * into v_acceptance;

  update estimates set status = 'accepted', updated_at = now() where id = v_est.id;

  return v_acceptance;
end;
$$;

revoke all on function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text) from public;
revoke all on function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text) from authenticated;
grant execute on function record_estimate_acceptance(uuid, text, jsonb, text, text, inet, text) to service_role;
