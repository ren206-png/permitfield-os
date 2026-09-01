-- BILLING_PROPOSAL.md §3. New table for the Stripe billing integration --
-- org_subscriptions is a synced MIRROR of Stripe's own subscription state,
-- never the source of truth (Stripe is). Every org gets exactly one row,
-- created atomically alongside the org itself by extending
-- create_organization_with_owner() below (20260806000002...sql) -- so there
-- is no window where an org exists without a trial already started, and
-- lib/entitlements/index.ts's resolveEffectiveTier() never has to
-- special-case "row doesn't exist yet" for a legitimately new org (only for
-- one that predates this migration in an environment that reset/seeded
-- around it -- that case still resolves safely to the zero-feature
-- NO_PLAN_TIER, see that module's own header comment).

create type org_subscription_tier as enum ('starter', 'pro', 'enterprise');

-- Mirrors Stripe's own Subscription.status values, narrowed to the four
-- this app's entitlements logic actually branches on (BILLING_PROPOSAL.md
-- §3) -- 'incomplete'/'incomplete_expired'/'unpaid'/'paused' all fold to
-- 'canceled' before being written here (lib/billing/subscriptions.ts's
-- upsertOrgSubscription()), fail-closed rather than adding four more enum
-- values this codebase's entitlements logic has no distinct behavior for.
create type org_subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');

create table org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  tier org_subscription_tier not null default 'pro',
  status org_subscription_status not null default 'trialing',
  current_period_end timestamptz,
  -- Defaults to a 14-day trial from row creation (BILLING_PROPOSAL.md §2's
  -- TRIAL_DAYS, lib/billing/tiers.ts) -- create_organization_with_owner()
  -- below relies on this column default rather than passing an explicit
  -- value, so the two stay in sync by construction for every new org. If
  -- TRIAL_DAYS ever changes in application code, this default must be
  -- updated in a follow-up migration to match -- there is no single shared
  -- source between SQL and TypeScript for this constant.
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  -- No BEFORE UPDATE trigger maintains this -- confirmed zero such triggers
  -- exist anywhere in supabase/migrations/ (20260806000019's own header).
  -- lib/billing/subscriptions.ts's webhook handler sets this explicitly on
  -- every write, same convention every other updated_at column in this
  -- schema already follows.
  updated_at timestamptz not null default now()
);

create index org_subscriptions_stripe_customer_id_idx on org_subscriptions (stripe_customer_id);
create index org_subscriptions_stripe_subscription_id_idx on org_subscriptions (stripe_subscription_id);

alter table org_subscriptions enable row level security;

-- SELECT only: any org member can see their own org's billing state (the
-- /settings/billing page needs this for every member, not just the owner --
-- Checkout/Portal actions themselves are owner-gated at the Server Action
-- layer, same "RLS backstop + narrower application-layer check" split as
-- org_members_update's is_org_owner() gate alongside org_members_select's
-- broader is_org_member() one, 20260806000002...sql). No INSERT/UPDATE/
-- DELETE policy for `authenticated` at all -- this table is written exactly
-- two ways: create_organization_with_owner() (security definer, runs as the
-- owning role, bypasses RLS entirely) and lib/billing/subscriptions.ts's
-- webhook handler (service_role, also bypasses RLS) -- never directly by an
-- end-user session, mirrors client_access_tokens' own
-- service-role-only-write pattern in the second, client-portal Supabase
-- project (supabase-client-portal/supabase/migrations/20260814000001...sql).
create policy org_subscriptions_select on org_subscriptions
  for select to authenticated
  using (is_org_member(org_id));

-- Explicit grants only (20260806000011...sql's own convention). No INSERT/
-- UPDATE/DELETE grant to `authenticated` at all -- unlike
-- application_document_chunks' deliberate append-only-trigger-error
-- pattern (20260806000038...sql), there is no trigger here to surface a
-- friendlier error through, so RLS's blanket denial (no policy exists for
-- those commands on this role) is the only, and sufficient, backstop.
grant select on org_subscriptions to authenticated;
-- service_role: SELECT + UPDATE for the webhook handler's upsert (an
-- UPDATE, not INSERT, in the common case -- every org already has a row by
-- the time any webhook could plausibly fire for it, created atomically at
-- org-creation time by create_organization_with_owner() below); INSERT
-- included anyway as a defense-in-depth backfill path for an org that
-- predates this migration (see this migration's own header comment).
grant select, insert, update on org_subscriptions to service_role;

-- Extends the sole sanctioned org-creation path (20260806000002...sql) to
-- also insert this org's trial org_subscriptions row, atomically, in the
-- same security-definer call -- so there is never a window (not even
-- between two statements) where an org exists without one. `create or
-- replace` preserves the function's existing grant
-- (`grant execute ... to authenticated`, unchanged, not re-stated here).
create or replace function create_organization_with_owner(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name) values (org_name) returning id into new_org_id;
  insert into org_members (org_id, user_id, role) values (new_org_id, auth.uid(), 'owner');
  insert into org_subscriptions (org_id) values (new_org_id);
  return new_org_id;
end;
$$;
