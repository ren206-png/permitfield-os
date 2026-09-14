-- Gate 4 (Quotes & Payments), Phase B, migration 1 of N: change_orders +
-- change_order_acceptances + credit_notes (+ credit_note_number_counters).
--
-- Scope and design decisions here are the direct, literal implementation of
-- GATE_4_PHASE_B_FINDINGS.md §III's resolved Q1-Q6 answers (added
-- 2026-09-13, approved via the exact token "APPROVED: PHASE 4.B"). Rather
-- than re-derive the reasoning inline everywhere, each section below points
-- back to the specific answer it implements; read that doc's §III for the
-- full "why," not just the "what."
--
-- =====================================================================
-- CHANGE ORDERS (§III Q1, Q2, Q5)
-- =====================================================================
--
-- Q1's resolution: a change BEFORE an invoice is ever issued is not a
-- "change order" at all in this schema -- it is just a normal draft-time
-- edit to estimate_line_items/invoice_line_items, already fully supported
-- by Phase A with no new table needed. `change_orders` exists ONLY to
-- represent a change requested AFTER an invoice has already been issued
-- (and its issued_* snapshot has therefore already been locked immutable,
-- per 20260806000047's own CHECK constraints) -- modeled as option (b) from
-- the original findings doc: a change_order is a proposed DELTA (its own
-- line items, its own subtotal/tax/total), which upon acceptance and
-- issuance becomes a SECOND, ADDITIONAL invoice rather than ever mutating
-- the original issued invoice's snapshot. This keeps the "no cascading
-- edits to issued financial history" rule (GATE_4_FINDINGS.md, and
-- 20260806000047's header comment) fully intact -- a change_order never
-- writes to the invoice it targets, only reads its id for context.
--
-- ADDITIONS ONLY, discovered as a necessary constraint while implementing
-- (not present in the original §III draft, which had loosely floated
-- "can be negative for a reduction"): issue_change_order() below copies a
-- change order's accepted line items VERBATIM into a brand new invoice's
-- invoice_line_items rows, so change_order_line_items must satisfy that
-- table's own `unit_price_cents >= 0` CHECK (20260806000047) or the copy
-- would fail at issuance with a constraint violation. Separately,
-- lib/tax/engine.ts's calculateTax() (which both send_estimate()-equivalent
-- staff-facing totals AND the eventual issue_invoice() call run line items
-- through) throws a TypeError on any negative unitPriceCents -- there is no
-- code path in this codebase that can price a negative line item at all.
-- Resolving this cleanly rather than special-casing around it: a change
-- order represents ADDITIONAL approved scope/charges only (quantity > 0,
-- unit_price_cents >= 0, same shape as invoice_line_items exactly); a
-- REDUCTION in what's owed is credit_notes' job (see that section below),
-- never a negative change order. This is a coherent split, not a
-- limitation -- "the customer owes more because we agreed to do more work"
-- and "the customer owes less because of a billing adjustment" are two
-- different real-world events with two different documents in this schema,
-- matching Q3's own "credit notes are distinct from payment reversal,
-- covering a different event" reasoning one level further.
--
-- Q2's resolution: yes, a change order requires its own customer-facing
-- acceptance, mirroring estimate_acceptances (20260806000046) exactly --
-- same actor shape (no auth.uid() session), same "one acceptance per
-- version, plus a live re-check that nothing changed underneath the
-- customer between page-load and submit" pattern.
--
-- Q5's resolution (reconciling the Q2-vs-Q5 tension noted while drafting):
-- change orders get a LIGHTWEIGHT customer-facing treatment, not the full
-- artifact treatment invoices/estimates get -- no PDF, no dedicated
-- "invoice-like" document. The portal surface is a single accept-only page
-- confirming the delta amount and line items, structurally the same as
-- AcceptEstimateForm (typed_name + claimed_authority, no decline button --
-- see change_order_acceptances' own comment below for why "no decline" is
-- deliberate, not an oversight).
--
-- Status lifecycle: draft -> pending_acceptance -> accepted -> issued, with
-- `void` reachable from any of the first three (a staff member abandoning a
-- change order that was never accepted, or that was accepted but the
-- resulting invoice should not, after all, be issued). Once `issued`, a
-- change_order is exactly as immutable as the invoice it produced --
-- issuance is the terminal state, mirroring invoices' own
-- draft/issued/void shape (20260806000047) with one extra pre-issuance
-- step (pending_acceptance/accepted) inserted to hold the acceptance
-- record.
create type change_order_status as enum (
  'draft', 'pending_acceptance', 'accepted', 'issued', 'void'
);

create table change_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null,
  -- The already-issued invoice this change order proposes a delta against.
  -- Required (not nullable) -- per Q1's resolution, change_orders exist
  -- only for the post-issuance case; a pre-issuance change has no
  -- change_order row at all, so every row here necessarily targets a real
  -- issued invoice.
  source_invoice_id uuid not null,

  status change_order_status not null default 'draft',
  currency_code char(3) not null default 'CAD' check (currency_code = 'CAD'),

  title text not null,
  description text,

  -- Same "no calculation logic in SQL" discipline as estimates/invoices
  -- (20260806000045/47's header comments) -- these are working totals
  -- maintained by the domain-engine layer as change_order_line_items
  -- change, not computed here. Same >= 0 CHECK shape as invoices' own
  -- subtotal/discount/tax/total columns -- see this migration's header
  -- comment ("ADDITIONS ONLY") for why a change order's total is never
  -- negative.
  subtotal_cents bigint check (subtotal_cents is null or subtotal_cents >= 0),
  discount_total_cents bigint check (discount_total_cents is null or discount_total_cents >= 0),
  tax_total_cents bigint check (tax_total_cents is null or tax_total_cents >= 0),
  total_cents bigint check (total_cents is null or total_cents >= 0),

  -- Immutable snapshot taken at send_change_order_for_acceptance() time,
  -- mirroring estimate_revisions' snapshot-at-send moment (20260806000045)
  -- rather than issued_line_items' snapshot-at-issue moment (20260806000047)
  -- -- a change order's line items must be locked BEFORE the customer sees
  -- an acceptance page, not after, since the acceptance itself is what a
  -- customer is agreeing to.
  sent_line_items jsonb,
  sent_subtotal_cents bigint check (sent_subtotal_cents is null or sent_subtotal_cents >= 0),
  sent_discount_total_cents bigint check (sent_discount_total_cents is null or sent_discount_total_cents >= 0),
  sent_tax_total_cents bigint check (sent_tax_total_cents is null or sent_tax_total_cents >= 0),
  sent_total_cents bigint check (sent_total_cents is null or sent_total_cents >= 0),

  -- Set once issue_change_order() runs, immediately after
  -- record_change_order_acceptance() has moved status to 'accepted' (see
  -- both functions below). Kept
  -- separate from source_invoice_id (which points BACKWARD to the invoice
  -- this is a delta against) -- this points FORWARD to the new invoice this
  -- change order produced. Nullable until issuance.
  resulting_invoice_id uuid,

  voided_at timestamptz,
  void_reason text,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, id),
  foreign key (org_id, client_id) references clients (org_id, id),
  foreign key (org_id, source_invoice_id) references invoices (org_id, id),

  -- Mirrors invoices' own immutability CHECKs (20260806000047): a status
  -- past draft must carry a locked snapshot; a still-draft row must not.
  -- `void` is deliberately excluded from the "must carry a snapshot" side --
  -- void_change_order() below is reachable directly from 'draft' (an
  -- abandoned change order that was never sent at all), which correctly
  -- carries no sent_* snapshot; void reached from 'pending_acceptance' or
  -- 'accepted' already has one from send_change_order_for_acceptance(). So
  -- void's sent_line_items is simply unconstrained either way, never
  -- required and never forced null.
  check (status in ('draft', 'void') or (sent_line_items is not null and sent_total_cents is not null)),
  check (status <> 'draft' or (sent_line_items is null and sent_total_cents is null)),
  check (status <> 'issued' or resulting_invoice_id is not null),
  check (status = 'issued' or resulting_invoice_id is null),
  check (status <> 'void' or voided_at is not null)
);

create index change_orders_org_id_idx on change_orders (org_id);
create index change_orders_client_id_idx on change_orders (org_id, client_id);
create index change_orders_source_invoice_id_idx on change_orders (org_id, source_invoice_id);
create index change_orders_status_idx on change_orders (org_id, status);

alter table change_orders enable row level security;

-- Read/write posture mirrors invoices exactly (20260806000047): any org
-- member can read; direct authenticated write is allowed but confined to
-- status = 'draft' by the USING/WITH CHECK clauses, so once a change order
-- leaves draft (send_change_order_for_acceptance() flips it to
-- pending_acceptance) it can only move forward through the SECURITY
-- DEFINER RPCs below, never through a raw UPDATE. No role split beyond
-- is_org_member() for read/insert -- per §III Q6, everything in this
-- migration folds under the existing invoices.manage entitlement checked in
-- application code, not a new RLS-level role distinction; the RPCs below
-- still separately re-check is_org_billing_manager() for the privileged
-- transitions, same layered posture as invoices/payments.
create policy change_orders_select on change_orders
  for select to authenticated
  using (is_org_member(org_id));

create policy change_orders_insert on change_orders
  for insert to authenticated
  with check (is_org_member(org_id) and status = 'draft');

create policy change_orders_update on change_orders
  for update to authenticated
  using (is_org_member(org_id) and status = 'draft')
  with check (is_org_member(org_id) and status = 'draft');

create policy change_orders_delete on change_orders
  for delete to authenticated
  using (is_org_member(org_id) and status = 'draft');

grant select, insert, update, delete on change_orders to authenticated;
grant select, insert, update, delete on change_orders to service_role;

-- change_order_line_items: same shape/discipline as invoice_line_items
-- (20260806000047) -- see that table's header comment for the full
-- rounding/discount-order contract, not repeated here for the same
-- drift-risk reason already given there. unit_price_cents IS constrained
-- >= 0 here, identically to invoice_line_items -- see this migration's
-- header comment ("ADDITIONS ONLY") for why: issue_change_order() copies
-- these rows verbatim into a new invoice's invoice_line_items, which
-- enforces the same >= 0 CHECK, so allowing a negative value here would
-- only surface as a constraint-violation error at issuance time instead of
-- at draft-entry time.
create table change_order_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  change_order_id uuid not null,
  position int not null default 0,
  description text not null,
  quantity numeric not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_percent numeric check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  discount_fixed_cents bigint check (discount_fixed_cents is null or discount_fixed_cents >= 0),
  check (discount_percent is null or discount_fixed_cents is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, change_order_id) references change_orders (org_id, id) on delete cascade
);

create index change_order_line_items_change_order_id_idx on change_order_line_items (org_id, change_order_id);

alter table change_order_line_items enable row level security;

create policy change_order_line_items_select on change_order_line_items
  for select to authenticated
  using (is_org_member(org_id));

create policy change_order_line_items_insert on change_order_line_items
  for insert to authenticated
  with check (
    is_org_member(org_id)
    and exists (select 1 from change_orders co where co.id = change_order_id and co.org_id = change_order_line_items.org_id and co.status = 'draft')
  );

create policy change_order_line_items_update on change_order_line_items
  for update to authenticated
  using (
    is_org_member(org_id)
    and exists (select 1 from change_orders co where co.id = change_order_id and co.org_id = change_order_line_items.org_id and co.status = 'draft')
  )
  with check (
    is_org_member(org_id)
    and exists (select 1 from change_orders co where co.id = change_order_id and co.org_id = change_order_line_items.org_id and co.status = 'draft')
  );

create policy change_order_line_items_delete on change_order_line_items
  for delete to authenticated
  using (
    is_org_member(org_id)
    and exists (select 1 from change_orders co where co.id = change_order_id and co.org_id = change_order_line_items.org_id and co.status = 'draft')
  );

grant select, insert, update, delete on change_order_line_items to authenticated;
grant select, insert, update, delete on change_order_line_items to service_role;

-- change_order_acceptances: the customer-facing "I accept this change
-- order" record. Mirrors estimate_acceptances (20260806000046) field-for-
-- field and rationale-for-rationale -- same external-actor shape (no
-- auth.uid()), same `unique (change_order_id)` one-shot guarantee, same
-- stale-check re-verified live inside the RPC (here: "is this still the
-- change order's current sent snapshot," i.e. status is still
-- pending_acceptance -- a change order has no revision concept to go stale
-- AGAINST the way an estimate revision does, so the live re-check is
-- simpler: just re-confirm status = 'pending_acceptance' hasn't already
-- moved on to accepted/void by a concurrent call).
--
-- Deliberately NO decline table/column/RPC -- confirmed by reading this
-- codebase's actual estimate-acceptance flow (accept-estimate-form.tsx) that
-- estimates themselves have no decline path either; the house convention
-- for "customer doesn't want this" is that staff simply voids the
-- unaccepted item themselves (void_change_order() below), not a
-- customer-driven decline action. Matching that convention here rather
-- than introducing a decline concept nothing else in this schema has.
create table change_order_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  change_order_id uuid not null,
  -- Content hash of the sent snapshot accepted, same independent-proof
  -- reasoning as estimate_acceptances.revision_hash.
  snapshot_hash text not null,
  accepted_snapshot jsonb not null,
  typed_name text not null,
  claimed_authority text not null,
  ip inet,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (change_order_id),
  foreign key (org_id, change_order_id) references change_orders (org_id, id)
);

create index change_order_acceptances_change_order_id_idx on change_order_acceptances (org_id, change_order_id);

alter table change_order_acceptances enable row level security;

create policy change_order_acceptances_select on change_order_acceptances
  for select to authenticated
  using (is_org_member(org_id));

-- No INSERT/UPDATE/DELETE policy for `authenticated` -- same no-session
-- posture as estimate_acceptances. Append-only backstop regardless.
create trigger change_order_acceptances_append_only
  before update or delete on change_order_acceptances
  for each row execute function forbid_update_delete();

grant select on change_order_acceptances to authenticated;
grant select, insert on change_order_acceptances to service_role;

-- New column on invoices, added here rather than in a fresh migration that
-- edits 20260806000047 directly -- per this gate's append-only-migration
-- convention (never edit an already-applied migration file), any change to
-- an existing table happens via a new ALTER in a later-numbered migration,
-- exactly like 20260806000051 did for record_payment()'s function body.
-- Nullable + no backfill needed: every invoice created before this
-- migration simply has no originating change order, which is the correct
-- and only meaningful value for those rows.
alter table invoices add column originating_change_order_id uuid;
alter table invoices add constraint invoices_originating_change_order_id_fkey
  foreign key (org_id, originating_change_order_id) references change_orders (org_id, id);
create index invoices_originating_change_order_id_idx on invoices (org_id, originating_change_order_id);

-- send_change_order_for_acceptance(): draft -> pending_acceptance, taking
-- the immutable sent_* snapshot. Mirrors send_estimate()'s shape
-- (20260806000045) -- role-gated via is_org_billing_manager() (change
-- orders touch already-issued invoice history, the same billing-manager
-- tier as issue_invoice()/record_payment(), not the lighter bar ordinary
-- estimate drafting uses), locks the row `for update` first.
create or replace function send_change_order_for_acceptance(
  p_change_order_id uuid,
  p_sent_line_items jsonb,
  p_subtotal_cents bigint,
  p_discount_total_cents bigint,
  p_tax_total_cents bigint,
  p_total_cents bigint
)
returns change_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
begin
  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'change_order % not found', p_change_order_id;
  end if;

  if not is_org_billing_manager(v_co.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_co.org_id
      using errcode = '42501';
  end if;

  if v_co.status <> 'draft' then
    raise exception 'invalid_transition: change_order % is not in draft status (current: %)', p_change_order_id, v_co.status
      using errcode = '22023';
  end if;

  update change_orders set
    status = 'pending_acceptance',
    sent_line_items = p_sent_line_items,
    sent_subtotal_cents = p_subtotal_cents,
    sent_discount_total_cents = p_discount_total_cents,
    sent_tax_total_cents = p_tax_total_cents,
    sent_total_cents = p_total_cents,
    subtotal_cents = p_subtotal_cents,
    discount_total_cents = p_discount_total_cents,
    tax_total_cents = p_tax_total_cents,
    total_cents = p_total_cents,
    updated_at = now()
  where id = p_change_order_id
  returning * into v_co;

  return v_co;
end;
$$;

revoke all on function send_change_order_for_acceptance(uuid, jsonb, bigint, bigint, bigint, bigint) from public;
grant execute on function send_change_order_for_acceptance(uuid, jsonb, bigint, bigint, bigint, bigint) to authenticated;
grant execute on function send_change_order_for_acceptance(uuid, jsonb, bigint, bigint, bigint, bigint) to service_role;

-- record_change_order_acceptance(): the sole write path for
-- change_order_acceptances, mirroring record_estimate_acceptance()
-- (20260806000046) exactly, including its "no auth.uid()/is_org_member()
-- gate at all, only the function-execute grant restricted to service_role"
-- posture -- see that function's header comment for why (no session
-- exists to check against). Live re-check here: status must still be
-- pending_acceptance at the moment of acceptance, closing the same class of
-- race estimate_acceptances' current_revision_id check closes (a customer
-- accepting a change order staff just voided out from under them).
create or replace function record_change_order_acceptance(
  p_change_order_id uuid,
  p_snapshot_hash text,
  p_accepted_snapshot jsonb,
  p_typed_name text,
  p_claimed_authority text,
  p_ip inet default null,
  p_user_agent text default null
)
returns change_order_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
  v_acceptance change_order_acceptances;
begin
  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'change_order % not found', p_change_order_id;
  end if;

  if v_co.status <> 'pending_acceptance' then
    raise exception 'stale_change_order: change_order % is not awaiting acceptance (current status: %)',
      p_change_order_id, v_co.status
      using errcode = '22023';
  end if;

  if p_typed_name is null or btrim(p_typed_name) = '' then
    raise exception 'typed_name is required';
  end if;
  if p_claimed_authority is null or btrim(p_claimed_authority) = '' then
    raise exception 'claimed_authority is required';
  end if;

  insert into change_order_acceptances (
    org_id, change_order_id, snapshot_hash, accepted_snapshot,
    typed_name, claimed_authority, ip, user_agent
  ) values (
    v_co.org_id, v_co.id, p_snapshot_hash, p_accepted_snapshot,
    p_typed_name, p_claimed_authority, p_ip, p_user_agent
  )
  returning * into v_acceptance;

  update change_orders set status = 'accepted', updated_at = now() where id = v_co.id;

  return v_acceptance;
end;
$$;

revoke all on function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text) from public;
revoke all on function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text) from authenticated;
grant execute on function record_change_order_acceptance(uuid, text, jsonb, text, text, inet, text) to service_role;

-- issue_change_order(): accepted -> issued. Atomically creates a brand new
-- DRAFT invoice row copying the change order's sent_* delta as that
-- invoice's own draft-time working totals/line items (staff still calls
-- the existing, unmodified issue_invoice() afterward to actually issue that
-- new invoice through the normal numbering path -- this function
-- deliberately does NOT call issue_invoice() itself or assign an
-- invoice_number, keeping this function's blast radius to exactly "create
-- the delta invoice," not "also decide when it becomes a real numbered
-- invoice"). This is the concrete mechanism behind Q1's "becomes a second,
-- additional invoice for the delta" resolution.
create or replace function issue_change_order(
  p_change_order_id uuid
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
  v_src_invoice invoices;
  v_new_invoice invoices;
begin
  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'change_order % not found', p_change_order_id;
  end if;

  if not is_org_billing_manager(v_co.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_co.org_id
      using errcode = '42501';
  end if;

  if v_co.status <> 'accepted' then
    raise exception 'invalid_transition: change_order % is not in accepted status (current: %)', p_change_order_id, v_co.status
      using errcode = '22023';
  end if;

  select * into v_src_invoice from invoices where id = v_co.source_invoice_id and org_id = v_co.org_id;
  if v_src_invoice.id is null then
    raise exception 'invoice % not found in org %', v_co.source_invoice_id, v_co.org_id
      using errcode = '22023';
  end if;

  insert into invoices (
    org_id, client_id, project_id, source_estimate_id,
    status, currency_code, subtotal_cents, discount_total_cents,
    tax_total_cents, total_cents, originating_change_order_id, created_by
  ) values (
    v_co.org_id, v_co.client_id, v_src_invoice.project_id, v_src_invoice.source_estimate_id,
    'draft', v_co.currency_code, v_co.sent_subtotal_cents, v_co.sent_discount_total_cents,
    v_co.sent_tax_total_cents, v_co.sent_total_cents, v_co.id, auth.uid()
  )
  returning * into v_new_invoice;

  insert into invoice_line_items (org_id, invoice_id, position, description, quantity, unit_price_cents, discount_percent, discount_fixed_cents)
  select
    v_co.org_id,
    v_new_invoice.id,
    coalesce((item->>'position')::int, 0),
    item->>'description',
    (item->>'quantity')::numeric,
    (item->>'unit_price_cents')::bigint,
    case when item->>'discount_percent' is not null then (item->>'discount_percent')::numeric end,
    case when item->>'discount_fixed_cents' is not null then (item->>'discount_fixed_cents')::bigint end
  from jsonb_array_elements(coalesce(v_co.sent_line_items, '[]'::jsonb)) as item;

  update change_orders set
    status = 'issued',
    resulting_invoice_id = v_new_invoice.id,
    updated_at = now()
  where id = v_co.id;

  return v_new_invoice;
end;
$$;

revoke all on function issue_change_order(uuid) from public;
grant execute on function issue_change_order(uuid) to authenticated;
grant execute on function issue_change_order(uuid) to service_role;

-- void_change_order(): reachable from draft, pending_acceptance, or
-- accepted (but NOT issued -- once issued, the resulting invoice is real
-- financial history and this function's job is done; voiding that invoice,
-- if ever needed, goes through void_invoice() on the invoice itself, not
-- through this function). This is also the mechanism staff use for the
-- "customer doesn't want this change order" case, per this migration's
-- header comment on why no separate decline path exists.
create or replace function void_change_order(
  p_change_order_id uuid,
  p_void_reason text default null
)
returns change_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co change_orders;
begin
  select * into v_co from change_orders where id = p_change_order_id for update;
  if v_co.id is null then
    raise exception 'change_order % not found', p_change_order_id;
  end if;

  if not is_org_billing_manager(v_co.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_co.org_id
      using errcode = '42501';
  end if;

  if v_co.status not in ('draft', 'pending_acceptance', 'accepted') then
    raise exception 'invalid_transition: change_order % cannot be voided from status %', p_change_order_id, v_co.status
      using errcode = '22023';
  end if;

  update change_orders set
    status = 'void',
    voided_at = now(),
    void_reason = p_void_reason,
    updated_at = now()
  where id = p_change_order_id
  returning * into v_co;

  return v_co;
end;
$$;

revoke all on function void_change_order(uuid, text) from public;
grant execute on function void_change_order(uuid, text) to authenticated;
grant execute on function void_change_order(uuid, text) to service_role;

-- =====================================================================
-- CREDIT NOTES (§III Q3, Q4, Q5)
-- =====================================================================
--
-- Q3's resolution: a credit note is NOT a replacement for reverse_payment()
-- (20260806000049) -- the two coexist, covering two different real-world
-- events. reverse_payment() means "money that was recorded as paid is
-- being given back / was recorded in error" (a payment-side correction).
-- A credit_note means "the amount owed on a still-outstanding invoice is
-- being reduced without any money changing hands" (a billing-side
-- adjustment -- a goodwill discount, a billing correction, a scope
-- reduction agreed after the fact without going through the full
-- change-order delta-invoice flow). The new outstanding-balance formula
-- (applied in application code, per this gate's "no calculation logic in
-- SQL" rule, in app/(app)/invoices/[id]/page.tsx and
-- app/invoice/[token]/page.tsx) is:
--   issued_total_cents - sum(payments where status='recorded') - sum(credit_notes where status='issued')
--
-- Q4's resolution: credit notes get their own sequential per-org numbering,
-- mirroring invoice_number_counters/issue_invoice()'s exact mechanism
-- (20260806000047) -- a dedicated credit_note_number_counters table plus
-- the identical single-UPDATE...RETURNING concurrency-safety pattern,
-- copied verbatim rather than generalized into a shared "next number for
-- any counter kind" helper -- this gate's own migrations consistently
-- prefer one small, obviously-correct, independently-auditable copy per
-- concern over a shared abstraction (the same choice invoice_line_items'
-- header comment makes explicit for not re-typing estimate_line_items'
-- rounding contract, applied here to structure rather than prose).
create table credit_note_number_counters (
  org_id uuid primary key references organizations(id) on delete cascade,
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now()
);

alter table credit_note_number_counters enable row level security;

-- No policies at all for `authenticated` -- same lockdown as
-- invoice_number_counters; see that table's header comment.
grant select, insert, update on credit_note_number_counters to service_role;

-- Status lifecycle deliberately narrower than invoices'/change_orders':
-- draft -> issued -> void. There is no acceptance step (Q5: credit notes
-- are a staff-issued, org-favor-to-customer document -- there is nothing
-- for a customer to accept or reject, unlike a change order which asks the
-- customer to agree to a new charge). Once issued, a credit note is
-- immutable financial history exactly like an invoice; void is the only
-- available correction (never edit/delete), same "financial history is
-- never mutated in place" rule as everywhere else in this gate.
create type credit_note_status as enum ('draft', 'issued', 'void');

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null,
  -- The invoice this credit note reduces the amount owed on. Required --
  -- unlike a payment (which can span multiple invoices via
  -- payment_allocations, since a single e-transfer can cover several
  -- unrelated invoices), a credit note per Q3's resolution is a targeted
  -- adjustment to ONE specific invoice's specific balance, not a
  -- general-purpose client credit pool -- so this is a direct FK, not a
  -- many-to-many allocations table the way payments/payment_allocations is.
  invoice_id uuid not null,

  status credit_note_status not null default 'draft',
  currency_code char(3) not null default 'CAD' check (currency_code = 'CAD'),

  reason text,

  -- Assigned only at issue_credit_note() time; null on every draft. Same
  -- per-org uniqueness shape as invoice_number.
  credit_note_number bigint,

  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,

  -- Draft-time working amount, mirroring invoices' subtotal/total split
  -- discipline -- kept nullable/mutable pre-issue, locked into the
  -- issued_* column below at issue time. A credit note reduces a specific
  -- dollar amount off an invoice's balance; unlike invoices/change_orders,
  -- there are no separate line items to itemize (Q5's "minimal artifact"
  -- framing) -- just a single signed-positive amount and a free-text
  -- reason, since a credit note by definition only ever reduces (never
  -- increases) what's owed, so a >= 0 CHECK is correct here (unlike
  -- change_orders.total_cents, which is genuinely bidirectional).
  amount_cents bigint check (amount_cents is null or amount_cents > 0),

  issued_amount_cents bigint check (issued_amount_cents is null or issued_amount_cents > 0),
  -- Content hash of the issued state, same independent-proof reasoning as
  -- invoices.document_hash / estimate_acceptances.revision_hash.
  document_hash text,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, id),
  unique (org_id, credit_note_number),
  foreign key (org_id, client_id) references clients (org_id, id),
  foreign key (org_id, invoice_id) references invoices (org_id, id),

  check (status <> 'issued' or (credit_note_number is not null and issued_amount_cents is not null)),
  check (status <> 'draft' or (credit_note_number is null and issued_amount_cents is null)),
  check (status <> 'void' or voided_at is not null)
);

create index credit_notes_org_id_idx on credit_notes (org_id);
create index credit_notes_client_id_idx on credit_notes (org_id, client_id);
create index credit_notes_invoice_id_idx on credit_notes (org_id, invoice_id);
create index credit_notes_status_idx on credit_notes (org_id, status);

alter table credit_notes enable row level security;

-- Same layered posture as invoices (20260806000047): any org member reads;
-- direct authenticated write is confined to status = 'draft'; the
-- privileged issue/void transitions go through the SECURITY DEFINER RPCs
-- below only.
create policy credit_notes_select on credit_notes
  for select to authenticated
  using (is_org_member(org_id));

create policy credit_notes_insert on credit_notes
  for insert to authenticated
  with check (is_org_member(org_id) and status = 'draft');

create policy credit_notes_update on credit_notes
  for update to authenticated
  using (is_org_member(org_id) and status = 'draft')
  with check (is_org_member(org_id) and status = 'draft');

create policy credit_notes_delete on credit_notes
  for delete to authenticated
  using (is_org_member(org_id) and status = 'draft');

grant select, insert, update, delete on credit_notes to authenticated;
grant select, insert, update, delete on credit_notes to service_role;

-- issue_credit_note(): draft -> issued, the sole place a
-- credit_note_number is assigned. Mirrors issue_invoice()'s numbering
-- mechanism exactly (insert-on-conflict-do-nothing to guarantee the counter
-- row exists, then the single update...returning statement whose row lock
-- is the actual concurrency-safety proof -- see issue_invoice()'s header
-- comment, 20260806000047, for the full argument, not repeated verbatim
-- here for the same drift-risk reason given elsewhere in this migration).
--
-- Balance guard: STRENGTHENED beyond §III Q4's original draft text ("does
-- NOT check outstanding balance in SQL") to instead mirror
-- 20260806000051_record_payment_invoice_guards.sql's precedent directly --
-- that migration was itself a same-gate adversarial-review fix, added
-- AFTER Phase A initially shipped record_payment() with no invoice-status
-- or balance check at all, and found a real "phantom paid" bug as a
-- result. A credit note that could be issued against a void/draft invoice,
-- or that could push total issued credits past an invoice's
-- issued_total_cents (net of already-recorded payments), is the exact same
-- shape of financial-integrity bug in a new table, and this migration is
-- not going to reintroduce a bug this gate has already proven it makes
-- without a guard. Locks the target invoice `for update` (closing the
-- concurrent-over-credit race the same way 051 closes concurrent
-- overpayment) and rejects if the invoice is not `issued`, or if this
-- credit would push total issued credit notes + total recorded payments
-- past issued_total_cents.
create or replace function issue_credit_note(
  p_credit_note_id uuid
)
returns credit_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cn credit_notes;
  v_invoice invoices;
  v_number bigint;
  v_recorded_payments bigint;
  v_issued_credits bigint;
begin
  select * into v_cn from credit_notes where id = p_credit_note_id for update;
  if v_cn.id is null then
    raise exception 'credit_note % not found', p_credit_note_id;
  end if;

  if not is_org_billing_manager(v_cn.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_cn.org_id
      using errcode = '42501';
  end if;

  if v_cn.status <> 'draft' then
    raise exception 'invalid_transition: credit_note % is not in draft status (current: %)', p_credit_note_id, v_cn.status
      using errcode = '22023';
  end if;

  if v_cn.amount_cents is null or v_cn.amount_cents <= 0 then
    raise exception 'credit_note % has no positive amount_cents set', p_credit_note_id
      using errcode = '22023';
  end if;

  -- Row lock on the target invoice held for the rest of this transaction --
  -- see this function's header comment for why that is the actual
  -- concurrency-safety mechanism, same as 20260806000051.
  select * into v_invoice from invoices where id = v_cn.invoice_id and org_id = v_cn.org_id for update;
  if v_invoice.id is null then
    raise exception 'invoice % not found in org %', v_cn.invoice_id, v_cn.org_id
      using errcode = '22023';
  end if;

  if v_invoice.status <> 'issued' then
    raise exception 'invalid_transition: invoice % is not in issued status (current: %), a credit note cannot be issued against it',
      v_invoice.id, v_invoice.status
      using errcode = '22023';
  end if;

  select coalesce(sum(pa.amount_cents), 0) into v_recorded_payments
  from payment_allocations pa
  join payments p on p.id = pa.payment_id
  where pa.invoice_id = v_invoice.id and pa.org_id = v_cn.org_id and p.status = 'recorded';

  select coalesce(sum(cn.issued_amount_cents), 0) into v_issued_credits
  from credit_notes cn
  where cn.invoice_id = v_invoice.id and cn.org_id = v_cn.org_id and cn.status = 'issued';

  if v_recorded_payments + v_issued_credits + v_cn.amount_cents > coalesce(v_invoice.issued_total_cents, 0) then
    raise exception 'invalid_transition: credit note of % cents against invoice % would exceed its outstanding balance (recorded payments % + already-issued credits % of % cents)',
      v_cn.amount_cents, v_invoice.id, v_recorded_payments, v_issued_credits, v_invoice.issued_total_cents
      using errcode = '22023';
  end if;

  insert into credit_note_number_counters (org_id) values (v_cn.org_id)
    on conflict (org_id) do nothing;

  update credit_note_number_counters
    set next_number = next_number + 1, updated_at = now()
    where org_id = v_cn.org_id
    returning next_number - 1 into v_number;

  update credit_notes set
    status = 'issued',
    credit_note_number = v_number,
    issued_at = now(),
    issued_amount_cents = amount_cents,
    document_hash = null,
    updated_at = now()
  where id = p_credit_note_id
  returning * into v_cn;

  return v_cn;
end;
$$;

revoke all on function issue_credit_note(uuid) from public;
grant execute on function issue_credit_note(uuid) to authenticated;
grant execute on function issue_credit_note(uuid) to service_role;

-- void_credit_note(): the sole correction path, mirroring void_invoice()'s
-- shape. Deliberately does NOT touch credit_note_number_counters or reuse
-- the freed number, same never-reclaim-a-number rule as void_invoice().
-- Voiding a credit note releases the balance it had reduced back onto the
-- invoice's outstanding total (the outstanding-balance formula in
-- application code only ever sums status = 'issued' credit notes, so a
-- voided one simply stops counting -- no separate "reversal" row needed,
-- unlike payments' reverse_payment(), because a credit note has no
-- corresponding cash movement to record the reversal of).
create or replace function void_credit_note(
  p_credit_note_id uuid,
  p_void_reason text default null
)
returns credit_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cn credit_notes;
begin
  select * into v_cn from credit_notes where id = p_credit_note_id for update;
  if v_cn.id is null then
    raise exception 'credit_note % not found', p_credit_note_id;
  end if;

  if not is_org_billing_manager(v_cn.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_cn.org_id
      using errcode = '42501';
  end if;

  if v_cn.status <> 'issued' then
    raise exception 'invalid_transition: credit_note % is not in issued status (current: %)', p_credit_note_id, v_cn.status
      using errcode = '22023';
  end if;

  update credit_notes set
    status = 'void',
    voided_at = now(),
    void_reason = p_void_reason,
    updated_at = now()
  where id = p_credit_note_id
  returning * into v_cn;

  return v_cn;
end;
$$;

revoke all on function void_credit_note(uuid, text) from public;
grant execute on function void_credit_note(uuid, text) to authenticated;
grant execute on function void_credit_note(uuid, text) to service_role;
