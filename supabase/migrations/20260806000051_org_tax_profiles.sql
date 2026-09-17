-- Gate 4 (Quotes & Payments), Phase A, migration 1 of 7. Per
-- GATE_4_FINDINGS.md §I item 2 (resolved): issuance/void/refund/
-- tax-override/manual-payment-record rights map to `org_owner` +
-- `permit_manager` (no new `org_role` enum value for Phase A -- a dedicated
-- `billing_manager` role is a documented future gap, not silently invented
-- here). This migration adds the one reusable helper every later migration
-- in this gate needs for that role check, plus the org's own billing/tax
-- profile table.
--
-- `is_org_billing_manager()` mirrors `is_org_owner()`'s exact shape
-- (20260806000002) but recognizes the wider "permit_manager or above" tier
-- already established as this codebase's actual "who can take a
-- consequential, externally-visible action" boundary --
-- `transition_permit_status()`'s submission-tier check (20260806000022)
-- and `override_readiness_check()` (20260806000025) both hardcode this
-- identical four-value role list (`owner`, `org_owner`, `platform_admin`,
-- `permit_manager`) rather than a bespoke one; this function generalizes
-- that existing, already-load-bearing tier into one named, reusable
-- predicate so every later migration in this gate (estimates, invoices,
-- payments, tax overrides) calls the same function instead of re-typing
-- the same four-value IN-list six more times.
create or replace function is_org_billing_manager(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role in ('owner', 'org_owner', 'platform_admin', 'permit_manager')
  );
$$;

revoke all on function is_org_billing_manager(uuid) from public;
grant execute on function is_org_billing_manager(uuid) to authenticated;

-- org_tax_profiles: one row per org, mirroring org_subscriptions'
-- (20260806000040) 1:1-per-org pattern -- `org_id uuid not null unique`,
-- not a primary-key-is-org_id design, for the same reason org_subscriptions
-- chose that shape (a surrogate `id` stays consistent with every other
-- table in this schema, and an org that predates this migration in some
-- environment can still exist with zero rows here without special-casing a
-- non-existent primary key).
--
-- GST/HST and BC PST are tracked as two entirely independent
-- status+number+effective-date triples on purpose (GATE_4_FINDINGS.md §I
-- item 7 / the master prompt §5's explicit instruction: "never infer one
-- from the other"). An org can be GST-registered and PST-unregistered (the
-- common case for most provinces, since BC is the only one of AB/ON/BC with
-- its own separate PST), or vice versa in a hypothetical future province,
-- and this schema must never let application code compute one from the
-- other's value.
--
-- `country_code`/`currency_code` are both hard-pinned to Canada/CAD for
-- this launch scope (GATE_4_FINDINGS.md §8 assumption 3: "CAD, English"
-- launch, no i18n/multi-currency work in Phase A) -- CHECK constraints, not
-- omitted columns, so a later phase that DOES support another
-- country/currency only has to relax a CHECK, not add a column that every
-- existing row would need a backfill for. `currency_code` is `char(3)`,
-- matching `permit_applications.currency_code`'s exact type
-- (20260806000006) rather than inventing a new representation for the same
-- concept.
--
-- `timezone` is left nullable with no default: guessing a default IANA zone
-- for a Canadian contractor org would be an unverified assumption this
-- migration has no basis for (five time zones cross AB/ON/BC alone) --
-- the loose-format CHECK below only rejects obviously-malformed values
-- (no `/`), it does not validate against the real IANA tzdata list (that
-- would require either a bundled zone table or a Postgres extension this
-- schema doesn't otherwise need); full validation is left to the future
-- TypeScript layer that actually presents a zone picker.
--
-- `review_status` is this migration's own judgment call (GATE_4_FINDINGS.md
-- flags exactly this kind of decision, e.g. the correction/resubmission
-- state names in 20260806000022, as something to name explicitly rather
-- than silently invent): a lightweight staff-workflow marker for "has
-- someone with billing authority actually reviewed this org's registration
-- status," independent of and not gating anything at the DB layer today --
-- no CHECK or trigger reads it, it exists purely as a place for a future
-- settings UI to render a "needs review" banner.
create type tax_registration_status as enum ('unregistered', 'registered', 'unknown');

create table org_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,

  legal_name text not null,
  trading_name text,

  address_line1 text not null,
  address_line2 text,
  city text not null,
  province_code text not null check (province_code = upper(province_code) and length(province_code) = 2),
  postal_code text not null,
  country_code char(2) not null default 'CA' check (country_code = 'CA'),

  invoice_contact_name text,
  invoice_contact_email text,

  currency_code char(3) not null default 'CAD' check (currency_code = 'CAD'),
  -- Loose format check only (see header comment): requires at least one
  -- `/` (every real IANA zone name has the shape `Area/Location`), nothing
  -- more. NULL is allowed (org has not set a timezone yet).
  timezone text check (timezone is null or timezone like '%/%'),

  gst_hst_status tax_registration_status not null default 'unknown',
  gst_hst_number text,
  gst_hst_effective_date date,

  bc_pst_status tax_registration_status not null default 'unknown',
  bc_pst_number text,
  bc_pst_effective_date date,

  -- Gentle data-integrity nudge, not a hard business rule: a registered
  -- status without a number is very likely incomplete data entry, so this
  -- CHECK catches the obvious mistake at the DB layer while still allowing
  -- a genuinely-in-progress registration (status can be flipped to
  -- 'registered' the moment the number is known, in the same UPDATE).
  check (gst_hst_status <> 'registered' or gst_hst_number is not null),
  check (bc_pst_status <> 'registered' or bc_pst_number is not null),

  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'reviewed', 'needs_attention')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index org_tax_profiles_org_id_idx on org_tax_profiles (org_id);

alter table org_tax_profiles enable row level security;

-- Read: any org member, same broad-read/narrow-write split as every other
-- table this gate touches (GATE_4_FINDINGS.md's cross-cutting requirement:
-- "read access broader -- all org members can read"). Write: billing-manager
-- tier only -- this is registration/legal data feeding real tax filings, not
-- a working record every member edits (closer to `taxonomies`' owner-only
-- write shape, 20260806000019, than to `clients`' any-member write shape).
create policy org_tax_profiles_select on org_tax_profiles
  for select to authenticated
  using (is_org_member(org_id));

create policy org_tax_profiles_insert on org_tax_profiles
  for insert to authenticated
  with check (is_org_billing_manager(org_id));

create policy org_tax_profiles_update on org_tax_profiles
  for update to authenticated
  using (is_org_billing_manager(org_id))
  with check (is_org_billing_manager(org_id));

-- No DELETE policy/grant: this profile is a live, mutable settings record,
-- not append-only history, so "delete" is out of scope for this gate the
-- same way it is for `org_subscriptions` (a row is corrected via UPDATE,
-- never removed) -- not a hard business rule, just nothing in this phase
-- calls for a delete path.
grant select, insert, update on org_tax_profiles to authenticated;

-- Proactive service_role grant, same "don't wait to get bitten by the
-- BYPASSRLS-is-not-a-substitute-for-GRANT bug a third time" reasoning as
-- 20260806000019's tail comment -- no background job reads/writes this
-- table yet, but a future PDF-generation or tax-decision job plausibly will.
grant select, insert, update on org_tax_profiles to service_role;
