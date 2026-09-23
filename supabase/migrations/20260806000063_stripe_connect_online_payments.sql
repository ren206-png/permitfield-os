-- Gate 4 (Quotes & Payments), Phase C -- online payment collection for flow
-- B (a contractor's own customer paying an issued invoice) via Stripe
-- Connect. Implements GATE_4_PHASE_C_FINDINGS.md §I's seven recommendations
-- (all reviewed by the owner; "implement all recommendations" is this
-- migration's mandate). Every design choice below cites the specific
-- question it answers so a reviewer can check this migration against that
-- document line by line.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside any other DDL in
-- the same transaction as a later USE of that value against real data --
-- see 20260806000012's own header comment. This migration only ever
-- references 'card' inside CREATE FUNCTION bodies below (stored as text,
-- not executed until a later, separate call), never in a DML statement
-- executed by this file itself, so the single-add-value-per-file caution
-- that comment describes does not apply here -- same precedent
-- 20260806000018 (org_role) and 20260806000045 (ai_task_kind) already both
-- established: add the value, then keep going in the same file.

-- §I question 1: exactly one new payment_method value, named 'card' (not
-- 'stripe_online') -- names the payment mechanism, not the processor, same
-- register as the existing 'e_transfer'/'cheque' values. Stripe's own
-- finer-grained method detail (card vs. Interac vs. pre-auth debit) is
-- retrievable from Stripe directly per-charge if ever needed; this repo's
-- enum does not need to carry it too. Enums are a one-way door (§9) -- this
-- is deliberately the narrower, grow-later choice.
alter type payment_method add value if not exists 'card';

-- §I question 2 / §3: a webhook-invoked payment needs a durable link back to
-- the Stripe object that created it, both for reconciliation and as the
-- idempotency key for Stripe's at-least-once (not exactly-once) webhook
-- delivery -- see record_online_payment() below, which inserts once and
-- skips on a retried delivery rather than upserting (payments is
-- append-only; subscriptions, flow A's own idempotency precedent, is not).
-- Nullable (manual e_transfer/cheque payments never set it) and unique when
-- present (Postgres unique constraints permit any number of NULLs, so this
-- imposes no burden on the two existing payment methods).
alter table payments add column stripe_payment_intent_id text;
alter table payments add constraint payments_stripe_payment_intent_id_key unique (stripe_payment_intent_id);

-- §I question 2 risk note (§9 "webhook identity gap"): reverse_payment()'s
-- existing CHECK constraint requires `reversed_by is not null` whenever
-- status = 'reversed' -- correct for every reversal Phase A/B ever produced
-- (always a real staff actor). §I question 4's defensive backstop
-- (reverse_online_payment_from_webhook() below) is deliberately NOT a staff
-- action -- it fires from a `charge.refunded` webhook event with no
-- `auth.uid()` at all, covering a refund issued directly from the Stripe
-- Dashboard rather than through this app. reversed_by = NULL is the correct,
-- honest representation of that case ("no PermitField user did this"), not
-- a workaround -- so the original CHECK is relaxed to require only
-- `reversed_at is not null` on reversal, leaving `reversed_by` optional.
-- The paired CHECK below it (non-reversed rows must have reversed_by/
-- reversed_at/reversal_reason all null) is untouched -- it says nothing
-- about what's required OF a reversed row, only what's forbidden on an
-- active one, so it stays correct unchanged.
--
-- The original constraint was declared inline, unnamed, inside
-- 20260806000056_payments.sql's own CREATE TABLE -- Postgres auto-generates
-- a name for it that this migration has no reliable way to predict from
-- outside that file (and hardcoding a guessed name would silently no-op via
-- IF EXISTS if the guess were wrong, which is worse than an explicit,
-- self-verifying lookup). Found dynamically here by matching its actual
-- definition text instead, then replaced with an explicitly-named
-- constraint so any *future* migration can reference it by name directly.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'payments'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%reversed_by IS NOT NULL%reversed_at IS NOT NULL%';

  if v_conname is not null then
    execute format('alter table payments drop constraint %I', v_conname);
  else
    raise exception 'Could not locate the payments "reversed requires reversed_by/reversed_at" CHECK constraint to relax -- 20260806000056_payments.sql may have changed shape.';
  end if;
end $$;

alter table payments add constraint payments_reversed_requires_reversed_at
  check (status <> 'reversed' or reversed_at is not null);

-- §I question 5 / §3: a dedicated 1:1 table, following org_subscriptions's
-- own precedent (a new table rather than widening `organizations`) for a
-- second-project-style integration whose fields are meaningless for an org
-- that never onboards. Deliberately a *mirror* of Stripe's own Connect
-- account object (charges_enabled/payouts_enabled/details_submitted are the
-- exact three fields Stripe's `account.updated` event reports and that this
-- codebase's own onboarding-status check needs), same "Stripe is the source
-- of truth, this table is a synced mirror" posture flow A's org_subscriptions
-- already establishes -- not an audit ledger, so plain UPDATE-in-place (no
-- append-only trigger) is the correct shape here, unlike payments.
create table org_stripe_connect_accounts (
  org_id uuid primary key references organizations(id) on delete cascade,
  stripe_connect_account_id text not null unique,
  -- Standard Connect accounts (§I question 5's recommendation) always start
  -- false and are flipped true only by a real account.updated event
  -- (update_org_stripe_connect_account_status() below) -- never assumed
  -- true just because a row exists, since Stripe-side KYC/verification is
  -- what actually gates these, not PermitField creating the account object.
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index org_stripe_connect_accounts_account_id_idx on org_stripe_connect_accounts (stripe_connect_account_id);

alter table org_stripe_connect_accounts enable row level security;

-- Read: any org member -- the org-facing settings page (§I question 5)
-- needs to show every member "is online payment collection set up," not
-- just the owner/billing-manager tier that can act on it, same "read is
-- open to the org, write is the narrower is_org_billing_manager() tier"
-- split org_tax_profiles/org_subscriptions both already use.
create policy org_stripe_connect_accounts_select on org_stripe_connect_accounts
  for select to authenticated
  using (is_org_member(org_id));

-- No direct authenticated INSERT/UPDATE policy at all -- same posture as
-- payments/payment_allocations (§1): the only writers are the two RPCs
-- below, each independently gated for its own actor shape (a real staff
-- session starting onboarding, vs. a webhook-authenticated status sync).
grant select on org_stripe_connect_accounts to authenticated;
grant select, insert, update on org_stripe_connect_accounts to service_role;

-- upsert_org_stripe_connect_account(): the STAFF-initiated half of §I
-- question 5's onboarding flow -- called right after
-- stripe.accounts.create() succeeds, by a real authenticated org actor
-- (the settings-page Server Action), so this reuses is_org_billing_manager()
-- unchanged, the same role tier record_payment()/reverse_payment()/
-- org_tax_profiles writes already use for "a consequential financial action
-- for this org." Deliberately does NOT touch charges_enabled/payouts_enabled/
-- details_submitted on conflict -- those three are exclusively the webhook
-- path's (update_org_stripe_connect_account_status()) responsibility, so a
-- staff member re-running onboarding (e.g. after an interrupted Account
-- Link flow) can never accidentally reset a still-accurate enabled/
-- submitted flag back to a stale default.
create or replace function upsert_org_stripe_connect_account(
  p_org_id uuid,
  p_stripe_connect_account_id text
)
returns org_stripe_connect_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row org_stripe_connect_accounts;
begin
  if not is_org_billing_manager(p_org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', p_org_id
      using errcode = '42501';
  end if;

  if p_stripe_connect_account_id is null or length(trim(p_stripe_connect_account_id)) = 0 then
    raise exception 'stripe_connect_account_id must not be empty';
  end if;

  insert into org_stripe_connect_accounts (org_id, stripe_connect_account_id)
  values (p_org_id, p_stripe_connect_account_id)
  on conflict (org_id) do update set
    stripe_connect_account_id = excluded.stripe_connect_account_id,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function upsert_org_stripe_connect_account(uuid, text) from public;
grant execute on function upsert_org_stripe_connect_account(uuid, text) to authenticated;
grant execute on function upsert_org_stripe_connect_account(uuid, text) to service_role;

-- update_org_stripe_connect_account_status(): the WEBHOOK-driven half --
-- `account.updated` has no `auth.uid()` at all (same identity gap §I
-- question 2 found for payment_intent.succeeded), so, per that question's
-- reasoning, this is a second, narrowly-scoped, service_role-only RPC rather
-- than reusing the staff-facing function above under a relaxed role check.
-- Looked up by stripe_connect_account_id (the only identifier a Connect
-- webhook event reliably carries), not org_id.
create or replace function update_org_stripe_connect_account_status(
  p_stripe_connect_account_id text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_details_submitted boolean
)
returns org_stripe_connect_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row org_stripe_connect_accounts;
begin
  update org_stripe_connect_accounts set
    charges_enabled = p_charges_enabled,
    payouts_enabled = p_payouts_enabled,
    details_submitted = p_details_submitted,
    updated_at = now()
  where stripe_connect_account_id = p_stripe_connect_account_id
  returning * into v_row;

  if v_row.org_id is null then
    -- No local row for this Stripe account id -- either a webhook arriving
    -- before upsert_org_stripe_connect_account()'s own insert has committed
    -- (a real, if narrow, ordering race), or an account this app didn't
    -- create. Raising (rather than silently no-op-succeeding) surfaces this
    -- to the webhook route's try/catch, which logs it -- same "fail loud on
    -- a data-integrity surprise" discipline record_payment()'s invoice
    -- lookups already follow, not a routine skip like an unrecognized event
    -- type.
    raise exception 'no org_stripe_connect_accounts row found for stripe account %', p_stripe_connect_account_id;
  end if;

  return v_row;
end;
$$;

revoke all on function update_org_stripe_connect_account_status(text, boolean, boolean, boolean) from public;
grant execute on function update_org_stripe_connect_account_status(text, boolean, boolean, boolean) to service_role;

-- record_online_payment(): §I question 2's answer, option (a) narrowly
-- scoped. record_payment() cannot be reused unchanged -- it hard-requires
-- is_org_billing_manager(), which reads auth.uid(), which is NULL for a
-- webhook caller, so every webhook-triggered call would fail
-- insufficient_privilege. This is a SEPARATE, service_role-only RPC, never
-- granted to `authenticated` -- authorization shifts entirely from a role
-- check to webhook signature verification (done in TypeScript before this
-- is ever called), mirroring flow A's handleStripeWebhookEvent() posture
-- exactly (§1).
--
-- Scoped to exactly one invoice per call (§I question 7: invoices only,
-- no estimate deposits, and a Stripe Checkout Session is created against
-- one invoice's outstanding balance at a time) -- unlike record_payment(),
-- which accepts an arbitrary allocations array for a manually-recorded
-- payment that might really cover several invoices at once. The
-- allocation-sum invariant record_payment() enforces in SQL is reproduced
-- here for the same reason that migration's own header gives: duplicating
-- it in TypeScript would be a second place for the two checks to drift
-- apart.
--
-- Idempotent by stripe_payment_intent_id: Stripe guarantees at-least-once,
-- not exactly-once, webhook delivery (§1) -- a retried
-- payment_intent.succeeded for an already-recorded payment_intent_id
-- returns the existing row unchanged rather than erroring or double-
-- inserting.
create or replace function record_online_payment(
  p_org_id uuid,
  p_client_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_stripe_payment_intent_id text,
  p_received_at date default current_date
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_invoice invoices;
  v_already_recorded bigint;
begin
  if p_stripe_payment_intent_id is null or length(trim(p_stripe_payment_intent_id)) = 0 then
    raise exception 'stripe_payment_intent_id must not be empty';
  end if;

  -- Idempotency guard -- see header comment. Checked before any validation
  -- below so a retried delivery of an event whose invoice has since changed
  -- state (e.g. voided after the first delivery already recorded the
  -- payment) still returns the original row instead of re-validating
  -- against now-stale invoice state.
  select * into v_payment from payments where stripe_payment_intent_id = p_stripe_payment_intent_id;
  if v_payment.id is not null then
    return v_payment;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount_cents must be positive';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id and org_id = p_org_id for update;
  if v_invoice.id is null then
    raise exception 'invalid_transition: invoice % not found in org %', p_invoice_id, p_org_id
      using errcode = '22023';
  end if;

  if v_invoice.status <> 'issued' then
    raise exception 'invalid_transition: invoice % is not in issued status (current: %), online payments cannot be applied to it',
      p_invoice_id, v_invoice.status
      using errcode = '22023';
  end if;

  select coalesce(sum(pa.amount_cents), 0) into v_already_recorded
  from payment_allocations pa
  join payments p on p.id = pa.payment_id
  where pa.invoice_id = p_invoice_id and pa.org_id = p_org_id and p.status = 'recorded';

  if v_already_recorded + p_amount_cents > coalesce(v_invoice.issued_total_cents, 0) then
    raise exception 'invalid_transition: online payment of % cents to invoice % would exceed its outstanding balance (already recorded % of % cents)',
      p_amount_cents, p_invoice_id, v_already_recorded, v_invoice.issued_total_cents
      using errcode = '22023';
  end if;

  -- recorded_by is left NULL (its existing nullable default) -- no
  -- PermitField user acted here, a customer's own Stripe Checkout completion
  -- did. method = 'card' per §I question 1.
  insert into payments (org_id, client_id, method, amount_cents, received_at, stripe_payment_intent_id)
  values (p_org_id, p_client_id, 'card', p_amount_cents, p_received_at, p_stripe_payment_intent_id)
  returning * into v_payment;

  insert into payment_allocations (org_id, payment_id, invoice_id, amount_cents)
  values (p_org_id, v_payment.id, p_invoice_id, p_amount_cents);

  return v_payment;
end;
$$;

revoke all on function record_online_payment(uuid, uuid, uuid, bigint, text, date) from public;
grant execute on function record_online_payment(uuid, uuid, uuid, bigint, text, date) to service_role;

-- reverse_online_payment_from_webhook(): §I question 4's defensive backstop
-- ONLY -- the primary refund path is staff-initiated (a real person clicks
-- "refund" in the settings UI, which calls Stripe's refund API and then the
-- existing, UNMODIFIED reverse_payment() RPC, reusing its
-- is_org_billing_manager() gate exactly as-is, since that action has a real
-- auth.uid() session). This function exists only to keep the ledger from
-- silently drifting from Stripe's own record when a refund is instead
-- issued directly from the Stripe Dashboard, outside this app entirely --
-- the new Phase C webhook's `charge.refunded` handler calls this, with no
-- session, hence service_role-only, same identity-gap reasoning as
-- record_online_payment() above.
--
-- Looked up by stripe_payment_intent_id (a refund's charge always traces
-- back to the PaymentIntent that created it) rather than a payment id, since
-- the webhook event has no PermitField-native id to hand in. Idempotent by
-- status check: a payment already 'reversed' (e.g. the staff-initiated path
-- already handled it, and Stripe's own refund.updated/charge.refunded events
-- arrive afterward as confirmation, or Stripe redelivers the same event) is
-- returned unchanged rather than raising -- same "skip, don't guess, don't
-- double-apply" idempotency posture as record_online_payment()'s insert-once
-- guard.
create or replace function reverse_online_payment_from_webhook(
  p_stripe_payment_intent_id text,
  p_reversal_reason text default 'Reversed via Stripe charge.refunded webhook (refund issued outside PermitField).'
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
begin
  select * into v_payment from payments where stripe_payment_intent_id = p_stripe_payment_intent_id for update;
  if v_payment.id is null then
    raise exception 'no payment found for stripe_payment_intent_id %', p_stripe_payment_intent_id;
  end if;

  if v_payment.status = 'reversed' then
    return v_payment;
  end if;

  -- reversed_by intentionally left NULL -- see this migration's header
  -- comment on payments_reversed_requires_reversed_at for why that CHECK was
  -- relaxed specifically to make this legitimate: no PermitField user
  -- performed this reversal.
  update payments set
    status = 'reversed',
    reversed_at = now(),
    reversal_reason = p_reversal_reason,
    updated_at = now()
  where id = v_payment.id
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function reverse_online_payment_from_webhook(text, text) from public;
grant execute on function reverse_online_payment_from_webhook(text, text) to service_role;
