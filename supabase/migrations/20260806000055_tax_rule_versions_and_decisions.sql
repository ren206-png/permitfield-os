-- Gate 4 (Quotes & Payments), Phase A, migration 5 of 7: tax_rule_versions
-- and tax_decisions -- STORAGE SHAPE ONLY, per this task's explicit scope
-- limit. No tax-calculation logic exists anywhere in this migration (no
-- function computes a tax amount, no trigger derives one, no CHECK
-- encodes a rate formula) -- that belongs to a future TypeScript domain
-- engine, exactly like the discount/rounding math documented-but-not-
-- implemented in 20260806000052_estimates.sql.
--
-- GATE_4_FINDINGS.md §I item 7 (NOT resolved, explicitly named a release
-- blocker by the master prompt itself, and explicitly NOT re-litigated in
-- this pass): the actual current CRA GST/HST rate and BC's current PST
-- rate/registration rules have not been verified against a live primary
-- source in this environment. Every seed row below is therefore marked
-- `verified = false` and its `source_note` begins with the literal string
-- `UNVERIFIED` -- this is fixture data for exercising the schema and the
-- future domain engine's plumbing, not a certified rate table. `verified`
-- defaults to false and this migration never sets it true anywhere (no
-- UPDATE statement in this file touches it) -- flipping it is a future,
-- separate, business-reviewed action, not a schema concern.
create table tax_rule_versions (
  id uuid primary key default gen_random_uuid(),
  province_code text not null check (province_code = upper(province_code) and length(province_code) = 2),
  tax_type text not null check (tax_type in ('gst', 'hst', 'gst_hst', 'pst')),
  rate_percent numeric not null check (rate_percent >= 0 and rate_percent <= 100),
  effective_from date not null,
  -- null effective_to means "still in effect as of this row's insertion" --
  -- a later migration/seed adds a new version and closes this one out by
  -- setting effective_to, it is never edited to change the rate in place
  -- (this table is itself meant to be append-only history of rate changes
  -- over time, enforced by the trigger below).
  effective_to date,
  verified boolean not null default false,
  source_note text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index tax_rule_versions_province_type_idx on tax_rule_versions (province_code, tax_type, effective_from);

alter table tax_rule_versions enable row level security;

-- Read: any org member -- every org, regardless of which province it
-- operates in, needs to read every province's rules (a contractor could in
-- principle take on a job crossing provinces), so this is not
-- org-scoped/tenant data at all -- it is shared platform reference data,
-- closer in spirit to a public lookup table than to any of this gate's
-- other org-scoped tables. Write: billing-manager tier only, matching the
-- same "who can take a consequential, externally-visible action" boundary
-- used everywhere else in this gate -- publishing a new tax rule version
-- is exactly that kind of action.
--
-- NOTE: `is_org_billing_manager(org_id)` takes a specific org as its
-- argument, but this table has no org_id column (it is not tenant data).
-- The write policies below therefore check membership in ANY org where the
-- caller holds owner/org_owner/platform_admin/permit_manager, rather than
-- reusing the function directly -- documented here as a deliberate,
-- one-off shape rather than a silent inconsistency.
create policy tax_rule_versions_select on tax_rule_versions
  for select to authenticated
  using (true);

create policy tax_rule_versions_insert on tax_rule_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from org_members
      where user_id = auth.uid()
        and role in ('owner', 'org_owner', 'platform_admin', 'permit_manager')
    )
  );

create policy tax_rule_versions_update on tax_rule_versions
  for update to authenticated
  using (
    exists (
      select 1 from org_members
      where user_id = auth.uid()
        and role in ('owner', 'org_owner', 'platform_admin', 'permit_manager')
    )
  )
  with check (
    exists (
      select 1 from org_members
      where user_id = auth.uid()
        and role in ('owner', 'org_owner', 'platform_admin', 'permit_manager')
    )
  );

-- Append-only backstop regardless of the update policy above -- the update
-- policy exists only so a billing manager can close out effective_to on a
-- superseded row; the trigger below still blocks any UPDATE that isn't
-- explicitly permitted... but forbid_update_delete() blocks ALL updates
-- unconditionally (it has no column-aware logic), so this migration favors
-- true immutability over the "close out effective_to" convenience and
-- expects a superseded rate to be modeled as a NEW row with its own
-- effective_from, never as an edit to the old row. The update policy above
-- is therefore intentionally dead code today, kept only for forward
-- compatibility if a future migration relaxes the trigger to be
-- column-aware; documented here rather than removed so the RLS grant
-- doesn't silently disagree with the trigger.
create trigger tax_rule_versions_append_only
  before update or delete on tax_rule_versions
  for each row execute function forbid_update_delete();

grant select, insert on tax_rule_versions to authenticated;
grant select, insert on tax_rule_versions to service_role;

-- Seed fixture rows: AB/ON/BC, GST/HST (+ BC's separate PST), one province-
-- tax fixture set per province per GATE_4_FINDINGS.md §8 assumption 3 /
-- master prompt §8. All UNVERIFIED per this migration's header comment.
-- Rates below are widely-known nominal figures (AB: GST only, no
-- provincial sales tax; ON: harmonized HST; BC: GST + separate PST) used
-- purely as plumbing fixtures -- NOT to be treated as certified for any
-- real filing without the future verification pass §I item 7 calls for.
insert into tax_rule_versions (province_code, tax_type, rate_percent, effective_from, verified, source_note) values
  ('AB', 'gst', 5.00, '2008-01-01', false, 'UNVERIFIED fixture seed -- nominal federal GST rate for Alberta (no provincial sales tax in AB); not verified against a live CRA source in this pass, see GATE_4_FINDINGS.md §I item 7.'),
  ('ON', 'hst', 13.00, '2010-07-01', false, 'UNVERIFIED fixture seed -- nominal harmonized HST rate for Ontario; not verified against a live CRA source in this pass, see GATE_4_FINDINGS.md §I item 7.'),
  ('BC', 'gst', 5.00, '2008-01-01', false, 'UNVERIFIED fixture seed -- nominal federal GST rate for British Columbia; not verified against a live CRA source in this pass, see GATE_4_FINDINGS.md §I item 7.'),
  ('BC', 'pst', 7.00, '2013-04-01', false, 'UNVERIFIED fixture seed -- nominal BC provincial PST rate, tracked entirely independently of BC''s GST row per this gate''s "never infer one from the other" rule; not verified against a live BC government source in this pass, see GATE_4_FINDINGS.md §I item 7.');

-- tax_decisions: the storage shape for "what tax treatment did the system
-- apply/propose to this estimate or invoice line item, and did a human
-- override it" -- no function in this migration computes rate_applied_percent
-- or tax_amount_cents from tax_rule_versions; both are written by whatever
-- future caller (domain engine or manual override) determines the value.
-- `status = 'review_required'` is this table's landing spot for
-- GATE_4_FINDINGS.md §9 risk 5's "mixed/ambiguous cases must route to
-- REVIEW_REQUIRED" instruction -- recorded here as a legal state this table
-- can represent, not as logic that decides when to use it.
create table tax_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Polymorphic-by-convention link to whichever line item this decision
  -- was made for -- 'estimate_line_item' or 'invoice_line_item' -- rather
  -- than two nullable FK columns, since exactly one of those two source
  -- tables applies per row and neither is itself an immutable/append-only
  -- table that would make a real FK safe (estimate_line_items rows can be
  -- deleted while the estimate is still draft). The CHECK below at least
  -- constrains the discriminator to the two known values; referential
  -- integrity to the actual source row is an application-layer concern
  -- deliberately left there, the same "no cross-table CHECK possible"
  -- constraint noted in estimate_acceptances' header comment.
  source_kind text not null check (source_kind in ('estimate_line_item', 'invoice_line_item')),
  source_line_item_id uuid not null,

  province_code text not null check (province_code = upper(province_code) and length(province_code) = 2),
  tax_rule_version_id uuid references tax_rule_versions (id),

  status text not null default 'applied' check (status in ('applied', 'review_required')),

  rate_applied_percent numeric check (rate_applied_percent is null or (rate_applied_percent >= 0 and rate_applied_percent <= 100)),
  tax_amount_cents bigint check (tax_amount_cents is null or tax_amount_cents >= 0),

  -- A human billing-manager override of whatever the (future) domain
  -- engine proposed -- both null on an un-overridden, purely-computed row.
  overridden_by uuid references auth.users(id),
  override_reason text,
  overridden_at timestamptz,
  check ((overridden_by is null and override_reason is null and overridden_at is null) or (overridden_by is not null and overridden_at is not null)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tax_decisions_org_id_idx on tax_decisions (org_id);
create index tax_decisions_source_idx on tax_decisions (org_id, source_kind, source_line_item_id);
create index tax_decisions_status_idx on tax_decisions (org_id, status);

alter table tax_decisions enable row level security;

-- Read: any org member. Write (insert always allowed for org members --
-- this is the "engine proposed a decision" path, no privilege needed to
-- record a computed proposal; but an override, i.e. setting the
-- overridden_by columns, is billing-manager gated), matching the tax
-- override right's GATE_4_FINDINGS.md §I item 2 role mapping.
create policy tax_decisions_select on tax_decisions
  for select to authenticated
  using (is_org_member(org_id));

create policy tax_decisions_insert on tax_decisions
  for insert to authenticated
  with check (
    is_org_member(org_id)
    and (overridden_by is null or is_org_billing_manager(org_id))
  );

create policy tax_decisions_update on tax_decisions
  for update to authenticated
  using (is_org_billing_manager(org_id))
  with check (is_org_billing_manager(org_id));

-- No DELETE policy/grant: a tax decision, once recorded, is corrected via a
-- new override UPDATE (or a new row for a re-computation), never removed --
-- same "financial history isn't hard-deleted" rule as invoices.
grant select, insert, update on tax_decisions to authenticated;
grant select, insert, update on tax_decisions to service_role;
