-- Gate 4 (Quotes & Payments), Phase A, migration 4 of 7: invoices, their
-- line items, and the concurrency-safe per-org sequential invoice-numbering
-- mechanism the master prompt requires be "proven, not assumed."
--
-- Overall shape deliberately mirrors 20260806000045_estimates.sql: a mutable
-- draft (invoices/invoice_line_items, editable while status = 'draft') plus
-- an immutable point-in-time snapshot taken at the moment of a privileged
-- state transition (issue_invoice() below), exactly the way
-- estimates/estimate_revisions split mutable-draft from immutable-sent.
-- Unlike estimates, the snapshot fields live on the `invoices` row itself
-- (issued_line_items jsonb + totals), not a separate revision table --
-- invoices are never re-issued the way an estimate can get a revision 2, 3,
-- ... (issuing a corrected invoice means voiding this one and drafting a
-- new one, per GATE_4_FINDINGS.md's "no cascading delete of issued
-- financial history" instruction), so a 1:1 immutable-snapshot-in-place
-- column set is sufficient and avoids an unused one-row-per-invoice child
-- table.
create type invoice_status as enum ('draft', 'issued', 'void');

-- invoice_number_counters: one row per org, holding the next sequential
-- invoice number to hand out. This table's *entire reason to exist* is
-- concurrency safety -- see issue_invoice() below for the actual mechanism.
-- It carries no RLS-readable business meaning of its own (no org member
-- ever needs to SELECT "what is our next number" directly; issue_invoice()
-- is the only sanctioned reader/writer), so it is locked down harder than
-- every other table in this migration: RLS enabled with zero policies for
-- `authenticated` (not even SELECT) and no authenticated grant at all --
-- only service_role and the SECURITY DEFINER functions below (which run as
-- the function owner, not the caller, so they need their own grant,
-- provided at the bottom of this file) can touch it.
create table invoice_number_counters (
  org_id uuid primary key references organizations(id) on delete cascade,
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now()
);

alter table invoice_number_counters enable row level security;

-- No policies at all for `authenticated` -- intentional, see header comment.
grant select, insert, update on invoice_number_counters to service_role;

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null,
  project_id uuid,
  -- Optional link back to the estimate this invoice was generated from --
  -- nullable because an org can issue a standalone invoice with no prior
  -- quote (GATE_4_FINDINGS.md never requires every invoice to originate
  -- from an estimate).
  source_estimate_id uuid,

  status invoice_status not null default 'draft',
  currency_code char(3) not null default 'CAD' check (currency_code = 'CAD'),

  -- Assigned only at issue time by issue_invoice(); null on every draft.
  -- Uniqueness is per-org (two different orgs can both have invoice #1),
  -- matching invoice_number_counters' per-org counter.
  invoice_number bigint,

  due_date date,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,

  scope_notes text,
  terms text,

  -- Draft-time working line-item totals are computed and stored by the
  -- application/domain-engine layer as line items change (same "no
  -- calculation logic in SQL" discipline as estimates -- see
  -- invoice_line_items' header comment below); these columns are simply
  -- nullable holders until issue_invoice() copies the final numbers into
  -- the immutable issued_* columns below and locks them via the CHECK
  -- constraint beneath.
  subtotal_cents bigint check (subtotal_cents is null or subtotal_cents >= 0),
  discount_total_cents bigint check (discount_total_cents is null or discount_total_cents >= 0),
  tax_total_cents bigint check (tax_total_cents is null or tax_total_cents >= 0),
  total_cents bigint check (total_cents is null or total_cents >= 0),

  -- Immutable issue-time snapshot: a full copy of the line items as they
  -- existed the instant issue_invoice() ran, exactly the same
  -- jsonb-snapshot-over-relational-child-table choice made for
  -- estimate_revisions.line_items (20260806000045) and for the identical
  -- reason -- no query needs relational access to a past invoice's line
  -- items, only "show me exactly what this PDF said," which a jsonb blob
  -- answers directly.
  issued_line_items jsonb,
  issued_subtotal_cents bigint check (issued_subtotal_cents is null or issued_subtotal_cents >= 0),
  issued_discount_total_cents bigint check (issued_discount_total_cents is null or issued_discount_total_cents >= 0),
  issued_tax_total_cents bigint check (issued_tax_total_cents is null or issued_tax_total_cents >= 0),
  issued_total_cents bigint check (issued_total_cents is null or issued_total_cents >= 0),
  -- Content hash of the issued snapshot, same "second independent proof of
  -- exactly what was issued" reasoning as estimate_acceptances.revision_hash
  -- (20260806000046) -- computed by the caller, stored verbatim, not
  -- computed in SQL.
  document_hash text,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, id),
  unique (org_id, invoice_number),
  foreign key (org_id, client_id) references clients (org_id, id),
  foreign key (org_id, project_id) references projects (org_id, id),
  foreign key (org_id, source_estimate_id) references estimates (org_id, id),

  -- The immutability contract, enforced as CHECK constraints rather than a
  -- trigger (same RLS/CHECK-first choice made throughout this gate, see
  -- estimates' header comment for the deviation rationale): once issued,
  -- an invoice must carry a number and a full snapshot; while still draft,
  -- it must carry neither (an invoice_number handed out then abandoned on a
  -- still-draft row would silently create a gap the moment a second draft
  -- got issued first -- see issue_invoice()'s comment for why numbers are
  -- only ever assigned atomically with the status flip, never earlier).
  check (status <> 'issued' or (invoice_number is not null and issued_line_items is not null and issued_total_cents is not null)),
  check (status <> 'draft' or (invoice_number is null and issued_line_items is null)),
  check (status <> 'void' or voided_at is not null)
);

create index invoices_org_id_idx on invoices (org_id);
create index invoices_client_id_idx on invoices (org_id, client_id);
create index invoices_project_id_idx on invoices (org_id, project_id);
create index invoices_status_idx on invoices (org_id, status);
create index invoices_due_date_idx on invoices (org_id, due_date);
create index invoices_source_estimate_id_idx on invoices (org_id, source_estimate_id);

alter table invoices enable row level security;

-- Read: any org member. Write (insert/update/delete): draft-only, same
-- RLS-conditional-on-status mechanism as estimates -- an issued/void
-- invoice can never be reached by an authenticated UPDATE/DELETE statement
-- because the USING clause excludes it, regardless of role. The privileged
-- issue/void transitions themselves go through the SECURITY DEFINER RPCs
-- below (which bypass RLS and do their own role check), matching
-- transition_permit_status()'s pattern (20260806000022) and this gate's
-- own is_org_billing_manager() role tier (20260806000044).
create policy invoices_select on invoices
  for select to authenticated
  using (is_org_member(org_id));

create policy invoices_insert on invoices
  for insert to authenticated
  with check (is_org_member(org_id) and status = 'draft');

create policy invoices_update on invoices
  for update to authenticated
  using (is_org_member(org_id) and status = 'draft')
  with check (is_org_member(org_id) and status = 'draft');

create policy invoices_delete on invoices
  for delete to authenticated
  using (is_org_member(org_id) and status = 'draft');

grant select, insert, update, delete on invoices to authenticated;
grant select, insert, update, delete on invoices to service_role;

-- invoice_line_items: same shape discipline as estimate_line_items
-- (20260806000045) -- fractional quantity, bigint cents, mutually exclusive
-- percent-or-fixed discount, no calculation logic in SQL. See that
-- migration's header comment for the full rounding/discount-order contract
-- this table's rows feed into; it is not repeated verbatim here since it is
-- the same contract, not a different one -- duplicating the full text would
-- risk the two copies silently drifting out of sync over time.
create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null,
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
  foreign key (org_id, invoice_id) references invoices (org_id, id) on delete cascade
);

create index invoice_line_items_invoice_id_idx on invoice_line_items (org_id, invoice_id);

alter table invoice_line_items enable row level security;

create policy invoice_line_items_select on invoice_line_items
  for select to authenticated
  using (is_org_member(org_id));

create policy invoice_line_items_insert on invoice_line_items
  for insert to authenticated
  with check (
    is_org_member(org_id)
    and exists (select 1 from invoices i where i.id = invoice_id and i.org_id = invoice_line_items.org_id and i.status = 'draft')
  );

create policy invoice_line_items_update on invoice_line_items
  for update to authenticated
  using (
    is_org_member(org_id)
    and exists (select 1 from invoices i where i.id = invoice_id and i.org_id = invoice_line_items.org_id and i.status = 'draft')
  )
  with check (
    is_org_member(org_id)
    and exists (select 1 from invoices i where i.id = invoice_id and i.org_id = invoice_line_items.org_id and i.status = 'draft')
  );

create policy invoice_line_items_delete on invoice_line_items
  for delete to authenticated
  using (
    is_org_member(org_id)
    and exists (select 1 from invoices i where i.id = invoice_id and i.org_id = invoice_line_items.org_id and i.status = 'draft')
  );

grant select, insert, update, delete on invoice_line_items to authenticated;
grant select, insert, update, delete on invoice_line_items to service_role;

-- issue_invoice(): the sole path from draft -> issued, and the sole place
-- an invoice_number is ever assigned. Role-gated to org_owner/permit_manager
-- tier (GATE_4_FINDINGS.md §I item 2: issuance is one of the listed
-- consequential actions), via the same is_org_billing_manager() predicate
-- defined in 20260806000044 rather than re-typing its four-value role list
-- a third time.
--
-- Concurrency-safety mechanism (the master prompt's explicit "prove it, do
-- not assume it" requirement): the single statement
--   update invoice_number_counters
--     set next_number = next_number + 1, updated_at = now()
--     where org_id = p_org_id
--     returning next_number - 1 into v_number;
-- is what actually makes two simultaneous issue_invoice() calls for the
-- SAME org safe. Postgres takes a row-level lock on the matching
-- invoice_number_counters row for the duration of the UPDATE; a second,
-- concurrent transaction's UPDATE against that same row blocks until the
-- first transaction commits or rolls back, then proceeds against the
-- now-updated value -- there is no read-then-write gap for two transactions
-- to race through with the same "next" value, unlike a naive
-- `select next_number ...` followed by a separate `update ... set
-- next_number = :next_number + 1`. This is the same "let a single
-- UPDATE...RETURNING statement be the atomic unit, rely on Postgres's own
-- row-lock serialization" idea `transition_permit_status()`'s optimistic
-- concurrency check (20260806000022) uses via `for update`, applied here to
-- counter allocation instead of status transition. A real two-concurrent-
-- session proof (two backgrounded psql processes issuing invoices for the
-- same org inside overlapping transactions) is provided separately as a
-- bash driver script, since a single sequential *.test.sql file cannot
-- exercise genuine lock contention.
--
-- insert ... on conflict (org_id) do nothing before the update guarantees
-- the counter row exists for orgs created before this migration (or, in
-- principle, any org that has simply never issued an invoice before) without
-- a separate backfill migration step.
create or replace function issue_invoice(
  p_invoice_id uuid,
  p_issued_line_items jsonb,
  p_subtotal_cents bigint,
  p_discount_total_cents bigint,
  p_tax_total_cents bigint,
  p_total_cents bigint,
  p_document_hash text default null
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv invoices;
  v_number bigint;
begin
  select * into v_inv from invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if not is_org_billing_manager(v_inv.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_inv.org_id
      using errcode = '42501';
  end if;

  if v_inv.status <> 'draft' then
    raise exception 'invalid_transition: invoice % is not in draft status (current: %)', p_invoice_id, v_inv.status
      using errcode = '22023';
  end if;

  insert into invoice_number_counters (org_id) values (v_inv.org_id)
    on conflict (org_id) do nothing;

  update invoice_number_counters
    set next_number = next_number + 1, updated_at = now()
    where org_id = v_inv.org_id
    returning next_number - 1 into v_number;

  update invoices set
    status = 'issued',
    invoice_number = v_number,
    issued_at = now(),
    issued_line_items = p_issued_line_items,
    issued_subtotal_cents = p_subtotal_cents,
    issued_discount_total_cents = p_discount_total_cents,
    issued_tax_total_cents = p_tax_total_cents,
    issued_total_cents = p_total_cents,
    document_hash = p_document_hash,
    subtotal_cents = p_subtotal_cents,
    discount_total_cents = p_discount_total_cents,
    tax_total_cents = p_tax_total_cents,
    total_cents = p_total_cents,
    updated_at = now()
  where id = p_invoice_id
  returning * into v_inv;

  return v_inv;
end;
$$;

revoke all on function issue_invoice(uuid, jsonb, bigint, bigint, bigint, bigint, text) from public;
grant execute on function issue_invoice(uuid, jsonb, bigint, bigint, bigint, bigint, text) to authenticated;
grant execute on function issue_invoice(uuid, jsonb, bigint, bigint, bigint, bigint, text) to service_role;

-- void_invoice(): the other privileged transition (issued -> void). Same
-- role gate as issue_invoice(). Deliberately does NOT touch
-- invoice_number_counters or reuse the freed number -- an issued invoice
-- number, once assigned, is never reclaimed or reassigned, even if the
-- invoice is immediately voided, so the numbering sequence for a given org
-- has gaps exactly where voided invoices are but never duplicates or
-- reordering. This matches the no-cascading-delete-of-issued-financial-
-- history instruction: void is a new status recorded on the existing row,
-- never a delete, and the issued_* snapshot columns are left untouched as
-- the permanent record of what was originally issued.
create or replace function void_invoice(
  p_invoice_id uuid,
  p_void_reason text default null
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv invoices;
begin
  select * into v_inv from invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if not is_org_billing_manager(v_inv.org_id) then
    raise exception 'insufficient_privilege: caller is not an org owner or permit manager for org %', v_inv.org_id
      using errcode = '42501';
  end if;

  if v_inv.status <> 'issued' then
    raise exception 'invalid_transition: invoice % is not in issued status (current: %)', p_invoice_id, v_inv.status
      using errcode = '22023';
  end if;

  update invoices set
    status = 'void',
    voided_at = now(),
    void_reason = p_void_reason,
    updated_at = now()
  where id = p_invoice_id
  returning * into v_inv;

  return v_inv;
end;
$$;

revoke all on function void_invoice(uuid, text) from public;
grant execute on function void_invoice(uuid, text) to authenticated;
grant execute on function void_invoice(uuid, text) to service_role;
