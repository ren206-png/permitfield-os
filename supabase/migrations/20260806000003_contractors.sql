-- 3.3, with a deliberate deviation from the literal draft column names
-- (`primary_state_license` / `license_state`): Canadian trade licensing is
-- provincial (e.g. ECRA/ESA licence numbers in Ontario), and per SS0.5 no
-- US-specific terminology should enter the codebase pre-emptively. Using
-- `license_province_code` now is a one-column rename away from a `_state`
-- sibling when the US phase actually lands -- not a structural blocker.

create table contractors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  company_name text not null,
  primary_license_number text,
  license_province_code text,
  license_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table contractors enable row level security;

create policy contractors_select on contractors
  for select to authenticated
  using (is_org_member(org_id));

create policy contractors_insert on contractors
  for insert to authenticated
  with check (is_org_member(org_id));

create policy contractors_update on contractors
  for update to authenticated
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy contractors_delete on contractors
  for delete to authenticated
  using (is_org_owner(org_id));
