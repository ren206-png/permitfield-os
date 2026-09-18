-- Gate 4 (Quotes & Payments), Phase A, migration 6 of 7: payments and
-- payment_allocations. Per this task's explicit scope, Phase A covers
-- MANUAL payment recording only (e-transfer / cheque) -- no online/card
-- payment processor integration exists anywhere in this migration, and
-- none is implied by it.
--
-- `credit_notes` is explicitly deferred to Phase B (GATE_4_FINDINGS.md's
-- own plan sketch lists it alongside `change_orders` as a Phase B item,
-- distinct from this migration's Phase A table list) -- not built here,
-- not stubbed here, genuinely out of scope for this pass. A refund today
-- is represented purely as a reversed payment row (see below); a proper
-- credit-note-against-an-invoice workflow is future work.
--
-- Correction model: append-only with a `reversed` status + a brand new
-- compensating row, never an edit or delete of the original -- the same
-- "financial history is never mutated in place" rule as invoices'
-- issued_* snapshot columns and estimate_revisions' immutability. A payment
-- entered in error is corrected by reverse_payment() (below) flipping its
-- status to 'reversed' (the row itself keeps its original amount/method/
-- date forever) and, if a corrected amount needs to exist, a fresh
-- record_payment() call creates an entirely new row.
create type payment_method as enum ('e_transfer', 'cheque');
create type payment_status as enum ('recorded', 'reversed');

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null,

  method payment_method not null,
  status payment_status not null default 'recorded',
  amount_cents bigint not null check (amount_cents > 0),
  currency_code char(3) not null default 'CAD' check (currency_code = 'CAD'),

  -- Free-text reference the org enters for their own reconciliation --
  -- an e-transfer confirmation code or a cheque number. Deliberately not
  -- structured/validated (format varies per bank/institution and this
  -- schema has no authority to enforce one), same "loose format, no
  -- external validation" posture as org_tax_profiles.timezone.
  reference_note text,

  received_at date not null,

  recorded_by uuid references auth.users(id),
  reversed_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversal_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, id),
  foreign key (org_id, client_id) references clients (org_id, id),

  check (status <> 'reversed' or (reversed_by is not null and reversed_at is not null)),
  check (status = 'reversed' or (reversed_by is null and reversed_at is null and reversal_reason is null))
);

create index payments_org_id_idx on payments (org_id);
create index payments_client_id_idx on payments (org_id, client_id);
create index payments_status_idx on payments (org_id, status);
create index payments_received_at_idx on payments (org_id, received_at);

alter table payments enable row level security;

-- Read: any org member. No direct INSERT/UPDATE/DELETE policy for
-- `authenticated` at all -- recording and reversing a payment are both
-- consequential, externally-meaningful financial actions
-- (GATE_4_FINDINGS.md §I item 2's "manual-payment-record" right, mapped to
-- org_owner/permit_manager), so both go exclusively through the two
-- SECURITY DEFINER RPCs below, which do their own is_org_billing_manager()
-- check. This is a stricter posture than invoices/estimates (which allow
-- direct authenticated INSERT/UPDATE while still draft) because a payment
-- has no "draft" concept at all -- every payment row that exists represents
-- a real, asserted-to-have-happened cash event from the moment it is
-- created, so there is no lower-stakes editable state to open up to a
-- plain RLS policy the way draft estimates/invoices have.
create policy payments_select on payments
  for select to authenticated
  using (is_org_member(org_id));

-- Deliberately NOT using forbid_update_delete() here, unlike most other
-- append-only tables in this schema: reverse_payment() below needs a real
-- UPDATE path (to flip status/reversed_* columns on the original row,
-- per this migration's header comment on the correction model), and that
-- trigger blocks ALL updates unconditionally, even from a SECURITY DEFINER
-- function's own context (a BEFORE trigger fires regardless of who defined
-- the calling function). The narrower guarantee this table relies on
-- instead: no INSERT/UPDATE grant to `authenticated` at all (only SELECT),
-- and the only two writers are record_payment()/reverse_payment(), each
-- independently role-gated and each only ever performing the one specific,
-- narrow write its name describes -- there is no un-gated raw-UPDATE path
-- for any caller to reach.
grant select on payments to authenticated;
grant select, insert, update on payments to service_role;

-- payment_allocations: how a payment's amount is applied against one or
-- more invoices. Modeled as a separate table (not a single invoice_id
-- column on payments) because a real e-transfer or cheque can cover
-- multiple invoices at once (a client paying off several outstanding
-- invoices in one transfer), and conversely one invoice can be paid via
-- multiple partial payments over time -- a genuine many-to-many, matching
-- why estimate_line_items/invoice_line_items are their own tables rather
-- than array columns.
create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, payment_id) references payments (org_id, id),
  foreign key (org_id, invoice_id) references invoices (org_id, id)
);

create index payment_allocations_payment_id_idx on payment_allocations (org_id, payment_id);
create index payment_allocations_invoice_id_idx on payment_allocations (org_id, invoice_id);

alter table payment_allocations enable row level security;

create policy payment_allocations_select on payment_allocations
  for select to authenticated
  using (is_org_member(org_id));

-- Same posture as payments itself: no direct authenticated write policy --
-- allocations are only ever created by record_payment() below, as part of
-- the same atomic call that creates the payment row itself.
grant select on payment_allocations to authenticated;
grant select, insert on payment_allocations to service_role;

create trigger payment_allocations_append_only
  before update or delete on payment_allocations
  for each row execute function forbid_update_delete();

-- record_payment(): the sole path to create a payment (+ its allocations)
-- atomically. Role-gated to org_owner/permit_manager tier via
-- is_org_billing_manager(), same as issue_invoice()/void_invoice().
-- `p_allocations` is a jsonb array of `{"invoice_id": "...", "amount_cents": n}`
-- objects -- accepted as a single jsonb parameter rather than requiring the
-- caller to make N separate RPC calls for an N-invoice allocation, and
-- validated (in total) against p_amount_cents so a payment can never be
-- recorded with allocations that don't sum to its own amount -- this IS a
-- structural/arithmetic integrity check (sum equality), not a tax/discount
-- calculation, so it stays consistent with this gate's "no business-math
-- logic in SQL" rule while still preventing an obviously-corrupt insert.
create or replace function record_payment(
  p_org_id uuid,
  p_client_id uuid,
  p_method payment_method,
  p_amount_cents bigint,
  p_received_at date,
  p_reference_note text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_alloc jsonb;
  v_allocated_total bigint := 0;
begin
  if not is_org_billing_manager(p_org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', p_org_id
      using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount_cents must be positive';
  end if;

  select coalesce(sum((elem->>'amount_cents')::bigint), 0) into v_allocated_total
  from jsonb_array_elements(p_allocations) as elem;

  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 and v_allocated_total <> p_amount_cents then
    raise exception 'invalid_transition: allocation total % does not equal payment amount %', v_allocated_total, p_amount_cents
      using errcode = '22023';
  end if;

  insert into payments (org_id, client_id, method, amount_cents, received_at, reference_note, recorded_by)
  values (p_org_id, p_client_id, p_method, p_amount_cents, p_received_at, p_reference_note, auth.uid())
  returning * into v_payment;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    insert into payment_allocations (org_id, payment_id, invoice_id, amount_cents)
    values (p_org_id, v_payment.id, (v_alloc->>'invoice_id')::uuid, (v_alloc->>'amount_cents')::bigint);
  end loop;

  return v_payment;
end;
$$;

revoke all on function record_payment(uuid, uuid, payment_method, bigint, date, text, jsonb) from public;
grant execute on function record_payment(uuid, uuid, payment_method, bigint, date, text, jsonb) to authenticated;
grant execute on function record_payment(uuid, uuid, payment_method, bigint, date, text, jsonb) to service_role;

-- reverse_payment(): the sole path to reverse a payment. Deliberately does
-- NOT delete or touch payment_allocations rows -- they remain exactly as
-- they were, a permanent record of what the (now-reversed) payment was
-- originally applied to; a caller reconciling invoice balances is expected
-- to filter/join on payments.status = 'recorded' to exclude reversed
-- payments' allocations from an outstanding-balance calculation, rather
-- than this schema deleting the allocation rows themselves.
create or replace function reverse_payment(
  p_payment_id uuid,
  p_reversal_reason text default null
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if v_payment.id is null then
    raise exception 'payment % not found', p_payment_id;
  end if;

  if not is_org_billing_manager(v_payment.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_payment.org_id
      using errcode = '42501';
  end if;

  if v_payment.status <> 'recorded' then
    raise exception 'invalid_transition: payment % is not in recorded status (current: %)', p_payment_id, v_payment.status
      using errcode = '22023';
  end if;

  update payments set
    status = 'reversed',
    reversed_by = auth.uid(),
    reversed_at = now(),
    reversal_reason = p_reversal_reason,
    updated_at = now()
  where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function reverse_payment(uuid, text) from public;
grant execute on function reverse_payment(uuid, text) to authenticated;
grant execute on function reverse_payment(uuid, text) to service_role;
