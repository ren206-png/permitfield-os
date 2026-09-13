-- Gate 4 (Quotes & Payments), Phase A, migration 2 of 7: estimates (quotes)
-- + their line items + the immutable revision-snapshot model.
--
-- Versioning model (per the master prompt's requirement that an accepted
-- quote must be provably the exact thing the customer saw, and
-- GATE_4_FINDINGS.md §7's suggestion that invoices need the identical
-- "immutable issue snapshot" concept): `estimates` holds the MUTABLE
-- draft/current-state pointer (status, currency, the row every future UI
-- edits directly); `estimate_line_items` is the mutable working set of line
-- items belonging to that draft; `estimate_revisions` is an APPEND-ONLY
-- table of immutable snapshots, one row per "send" action, holding a full
-- jsonb copy of the line items plus the scope/exclusions/terms text as they
-- existed at that exact moment.
--
-- jsonb snapshot, not a separate `estimate_revision_line_items` table (the
-- master prompt explicitly leaves this choice to this migration's
-- judgment, "your call, but justify it"): a relational
-- `estimate_revision_line_items` table would need its own append-only
-- trigger, its own RLS policy, and its own composite-FK-per-row shape for
-- zero real benefit in this phase -- nothing queries individual snapshot
-- line items relationally (no join, no aggregate-by-item-across-revisions
-- requirement anywhere in this gate's scope), and a jsonb column already
-- gives byte-for-byte reproducibility of exactly what was sent, which is
-- the actual requirement. `invoices` (migration 47 in this same gate) reuses
-- this identical jsonb-snapshot shape rather than inventing a second one.
--
-- Draft-vs-immutable enforcement is RLS-based, not trigger-based (see this
-- migration's own policy comments below for the exact mechanism) --
-- deliberately chosen over a bespoke BEFORE UPDATE trigger because it
-- reuses this codebase's dominant enforcement idiom (RLS policies keyed on
-- a status column, e.g. `permit_status_transitions`-gated RPCs,
-- `application_documents`'s revoked-DELETE-from-authenticated precedent)
-- rather than introducing a second mechanism for the same guarantee. Once
-- `estimates.status` leaves 'draft', the UPDATE/DELETE policies on both
-- `estimates` and `estimate_line_items` stop matching for `authenticated`
-- entirely -- there is no code path left for a direct client write to
-- reach, only the SECURITY DEFINER `send_estimate()` RPC below (which runs
-- as the table owner and so is unaffected by RLS).
--
-- Quantities are `numeric`, not `integer` -- fractional quantities (e.g.
-- 2.5 hours of labour, 12.75 linear feet of trim) must be representable per
-- the master prompt's explicit requirement. `unit_price_cents` is `bigint`,
-- never `numeric`/`float`/`money` (global money-safety rule, lib/money/cents.ts's
-- own float-free discipline). No tax/discount/rounding MATH happens in this
-- migration -- CHECK constraints only enforce non-negativity and structural
-- validity; a later TypeScript domain-engine pass computes actual totals
-- and passes them into `send_estimate()` as already-computed values (see
-- that function's own comment for why).
create type estimate_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired', 'void');

create table estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null,
  project_id uuid,
  status estimate_status not null default 'draft',
  currency_code char(3) not null default 'CAD' check (currency_code = 'CAD'),
  expiry_date date,
  -- Mutable draft-stage scope/exclusions/terms text -- copied verbatim into
  -- estimate_revisions' own columns at send time (see below), never
  -- referenced back from a revision, so editing these after a send never
  -- alters a past revision's snapshot.
  scope_notes text,
  exclusions text,
  terms text,
  created_by uuid references auth.users(id),
  -- Set by send_estimate() below; null while status = 'draft'. Points at
  -- the most recently sent snapshot -- what a customer-facing "view my
  -- quote" link should render, and what estimate_acceptances (migration 46)
  -- validates an acceptance attempt against.
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references clients (org_id, id),
  foreign key (org_id, project_id) references projects (org_id, id)
);

create index estimates_org_id_idx on estimates (org_id);
create index estimates_client_id_idx on estimates (org_id, client_id);
create index estimates_project_id_idx on estimates (org_id, project_id);
create index estimates_status_idx on estimates (org_id, status);

create table estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  estimate_id uuid not null,
  position int not null default 0,
  description text not null,
  quantity numeric not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  -- Discount handling: at most one of the two shapes below, never both --
  -- the CHECK enforces this structurally rather than by convention.
  -- Documented, single rounding order for the future TS domain engine (NOT
  -- implemented here -- no calculation logic belongs in this migration):
  --   1. line_subtotal_cents = round(quantity * unit_price_cents)
  --   2. if discount_percent is set: line_discount_cents =
  --      round(line_subtotal_cents * discount_percent / 100)
  --   3. if discount_fixed_cents is set: line_discount_cents =
  --      min(discount_fixed_cents, line_subtotal_cents) (never negative)
  --   4. line_total_cents = line_subtotal_cents - line_discount_cents
  -- This order (discount applied AFTER per-line rounding, not before) is
  -- the single source of truth for that decision -- the domain-engine pass
  -- must implement exactly this sequence, not re-derive its own.
  discount_percent numeric check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  discount_fixed_cents bigint check (discount_fixed_cents is null or discount_fixed_cents >= 0),
  check (discount_percent is null or discount_fixed_cents is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, estimate_id) references estimates (org_id, id) on delete cascade
);

create index estimate_line_items_estimate_id_idx on estimate_line_items (org_id, estimate_id);

-- Append-only, immutable snapshot. No org-scoped `unique(org_id, id)` is
-- needed for a further child table to reference (nothing references a
-- single revision row via composite FK in this phase) -- `estimates.
-- current_revision_id` and `estimate_acceptances.revision_id` (migration 46)
-- both use plain, non-composite FKs against this table's bare `id`, since
-- tenancy for both of those is already established via their own `org_id`
-- column and RLS, not re-derived through this FK.
create table estimate_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  estimate_id uuid not null,
  revision_number int not null check (revision_number > 0),
  sent_at timestamptz not null default now(),
  sent_by uuid references auth.users(id),
  currency_code char(3) not null,
  expiry_date date,
  scope_notes text,
  exclusions text,
  terms text,
  -- Full line-item snapshot at send time -- see this migration's header
  -- comment for why jsonb was chosen over a relational child table. Each
  -- array element is expected to carry the same shape as an
  -- estimate_line_items row (description, quantity, unit_price_cents,
  -- discount_percent, discount_fixed_cents, plus whatever computed
  -- per-line total the domain engine adds), but that shape is not
  -- schema-enforced here -- it's a point-in-time copy, not a live row.
  line_items jsonb not null,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  discount_total_cents bigint not null default 0 check (discount_total_cents >= 0),
  tax_total_cents bigint not null default 0 check (tax_total_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  unique (org_id, estimate_id, revision_number),
  foreign key (org_id, estimate_id) references estimates (org_id, id)
);

create index estimate_revisions_estimate_id_idx on estimate_revisions (org_id, estimate_id);

-- Added now that estimate_revisions exists (can't forward-reference a table
-- that doesn't exist yet at estimates' own CREATE TABLE statement above).
-- No ON DELETE clause -- estimate_revisions rows are never deleted (see the
-- append-only trigger below), so this FK's delete behavior is never
-- exercised in practice.
alter table estimates
  add constraint estimates_current_revision_id_fkey
  foreign key (current_revision_id) references estimate_revisions (id);

create index estimates_current_revision_id_idx on estimates (current_revision_id);

alter table estimates enable row level security;
alter table estimate_line_items enable row level security;
alter table estimate_revisions enable row level security;

-- estimates: broad read, any org member. INSERT open to any org member
-- (drafting a quote is ordinary working-record creation, same tier as
-- `projects`/`clients`, 20260806000019 -- not an issuance action by itself).
-- UPDATE/DELETE gated to `status = 'draft'` -- see this migration's header
-- comment for why this is the enforcement mechanism for immutability
-- instead of a trigger. Once `send_estimate()` (below) flips status away
-- from 'draft', no direct authenticated UPDATE/DELETE statement can match
-- either policy again, for any column, including status itself -- the only
-- way status advances again from here is another SECURITY DEFINER RPC.
create policy estimates_select on estimates
  for select to authenticated
  using (is_org_member(org_id));

create policy estimates_insert on estimates
  for insert to authenticated
  with check (is_org_member(org_id));

create policy estimates_update on estimates
  for update to authenticated
  using (is_org_member(org_id) and status = 'draft')
  with check (is_org_member(org_id) and status = 'draft');

create policy estimates_delete on estimates
  for delete to authenticated
  using (is_org_member(org_id) and status = 'draft');

-- estimate_line_items: mirrors estimates' own draft-gated write shape, via
-- an EXISTS check against the parent estimate's current status (line items
-- have no status column of their own to gate on directly).
create policy estimate_line_items_select on estimate_line_items
  for select to authenticated
  using (is_org_member(org_id));

create policy estimate_line_items_insert on estimate_line_items
  for insert to authenticated
  with check (
    is_org_member(org_id)
    and exists (select 1 from estimates e where e.org_id = estimate_line_items.org_id and e.id = estimate_line_items.estimate_id and e.status = 'draft')
  );

create policy estimate_line_items_update on estimate_line_items
  for update to authenticated
  using (
    is_org_member(org_id)
    and exists (select 1 from estimates e where e.org_id = estimate_line_items.org_id and e.id = estimate_line_items.estimate_id and e.status = 'draft')
  )
  with check (
    is_org_member(org_id)
    and exists (select 1 from estimates e where e.org_id = estimate_line_items.org_id and e.id = estimate_line_items.estimate_id and e.status = 'draft')
  );

create policy estimate_line_items_delete on estimate_line_items
  for delete to authenticated
  using (
    is_org_member(org_id)
    and exists (select 1 from estimates e where e.org_id = estimate_line_items.org_id and e.id = estimate_line_items.estimate_id and e.status = 'draft')
  );

-- estimate_revisions: SELECT only, is_org_member-gated -- same
-- "no direct-insert path offered at all" shape as
-- application_status_history (20260806000022): the only sanctioned writer
-- is send_estimate() below, a SECURITY DEFINER function that runs as the
-- table owner and needs no INSERT grant of its own.
create policy estimate_revisions_select on estimate_revisions
  for select to authenticated
  using (is_org_member(org_id));

-- Belt-and-suspenders append-only backstop, same forbid_update_delete()
-- reuse as every other immutable ledger in this schema -- defeats
-- service_role's BYPASSRLS too, in case a future job is ever granted
-- broader access than intended.
create trigger estimate_revisions_append_only
  before update or delete on estimate_revisions
  for each row execute function forbid_update_delete();

grant select, insert, update, delete on estimates to authenticated;
grant select, insert, update, delete on estimate_line_items to authenticated;
grant select on estimate_revisions to authenticated;
-- No INSERT/UPDATE/DELETE grant to `authenticated` on estimate_revisions --
-- see the policy comment above; send_estimate() writes as the table owner.

grant select, insert, update, delete on estimates to service_role;
grant select, insert, update, delete on estimate_line_items to service_role;
grant select, insert on estimate_revisions to service_role;

-- send_estimate(): the sanctioned "issuance" action for a quote --
-- snapshots the current draft (estimate + its line items) into a new,
-- immutable estimate_revisions row, advances estimates.status to 'sent',
-- and points current_revision_id at the new snapshot. Gated to
-- is_org_billing_manager() per GATE_4_FINDINGS.md §I item 2's resolved role
-- mapping ("issuance ... to org_owner and permit_manager"): sending a quote
-- is an externally-visible, consequential action, same tier as
-- transition_permit_status()'s submission-tier gate (20260806000022).
--
-- Totals (p_subtotal_cents/p_discount_total_cents/p_tax_total_cents/
-- p_total_cents) are passed in ALREADY COMPUTED by the caller, not derived
-- here -- this migration's own header comment documents the single
-- rounding/discount order the future TypeScript domain-engine pass must
-- implement; embedding that same math a second time in SQL would create
-- exactly the "two implementations that can silently disagree" risk this
-- codebase's own conventions warn against elsewhere (e.g.
-- lib/permit-status/transitions.ts vs. permit_status_transitions' own
-- header comment on keeping both in sync). This function's only numeric
-- responsibility is the CHECK constraints already on estimate_revisions
-- (non-negativity) -- it does no arithmetic of its own on these four values.
create or replace function send_estimate(
  p_estimate_id uuid,
  p_subtotal_cents bigint,
  p_discount_total_cents bigint,
  p_tax_total_cents bigint,
  p_total_cents bigint,
  p_line_items jsonb
)
returns estimate_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est estimates;
  v_role org_role;
  v_next_revision int;
  v_revision estimate_revisions;
begin
  select * into v_est from estimates where id = p_estimate_id for update;
  if v_est.id is null then
    raise exception 'estimate % not found', p_estimate_id;
  end if;

  if not is_org_member(v_est.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select role into v_role from org_members where org_id = v_est.org_id and user_id = auth.uid();
  if v_role not in ('owner', 'org_owner', 'platform_admin', 'permit_manager') then
    raise exception 'insufficient_privilege: role % may not send an estimate (requires permit_manager or above)', v_role
      using errcode = '42501';
  end if;

  if v_est.status <> 'draft' then
    raise exception 'invalid_transition: estimate % is not in draft status (currently %)', p_estimate_id, v_est.status
      using errcode = '22023';
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next_revision
  from estimate_revisions where org_id = v_est.org_id and estimate_id = v_est.id;

  insert into estimate_revisions (
    org_id, estimate_id, revision_number, sent_by, currency_code, expiry_date,
    scope_notes, exclusions, terms, line_items,
    subtotal_cents, discount_total_cents, tax_total_cents, total_cents
  ) values (
    v_est.org_id, v_est.id, v_next_revision, auth.uid(), v_est.currency_code, v_est.expiry_date,
    v_est.scope_notes, v_est.exclusions, v_est.terms, p_line_items,
    p_subtotal_cents, p_discount_total_cents, p_tax_total_cents, p_total_cents
  )
  returning * into v_revision;

  update estimates
  set status = 'sent', current_revision_id = v_revision.id, updated_at = now()
  where id = v_est.id;

  return v_revision;
end;
$$;

revoke all on function send_estimate(uuid, bigint, bigint, bigint, bigint, jsonb) from public;
grant execute on function send_estimate(uuid, bigint, bigint, bigint, bigint, jsonb) to authenticated;
