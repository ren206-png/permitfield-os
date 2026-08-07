-- 3.4 / 3.4a. Canadian permitting is authority-based, not city-based (SS0.6):
-- a jurisdiction is a municipal-level place; an authority is whoever actually
-- issues a given permit, which may be that municipality, or may be a
-- province-wide agency with jurisdiction_id = NULL (e.g. Ontario's ESA for
-- electrical, filed independently of any city).

create type coverage_level as enum ('verified', 'assisted', 'listed');

-- authority_level includes 'state' even though this is a Canada-only launch:
-- SS0.8 lists it as one of the four columns that make a future US phase a
-- migration rather than a rewrite, and SS0 states non-negotiable constraints
-- override conflicting instructions elsewhere in the spec (3.4a's literal
-- enum list omitted 'state'). No Canadian row will use it yet.
create type authority_level as enum ('municipal', 'provincial', 'state', 'agency', 'utility');

create type filing_mechanism as enum ('portal', 'pdf_email', 'in_person', 'api');

-- unit_system lives here (not on permit_applications) because it's a property
-- of the jurisdiction's measurement convention, not of any individual filing --
-- part of SS0.8's portability requirement, applied at the level it actually varies.
create table jurisdictions (
  id uuid primary key default gen_random_uuid(),
  country char(2) not null default 'CA',
  province_code text not null,
  municipality text not null,
  region text,
  unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
  portal_url text,
  coverage_level coverage_level not null default 'listed',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country, province_code, municipality)
);

create table authorities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  authority_level authority_level not null,
  province_code text not null,
  jurisdiction_id uuid references jurisdictions(id) on delete cascade,
  portal_url text,
  filing_mechanism filing_mechanism,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index authorities_jurisdiction_id_idx on authorities (jurisdiction_id);

alter table jurisdictions enable row level security;
alter table authorities enable row level security;

-- Reference data: readable by any authenticated user, writable only by
-- service_role (which bypasses RLS entirely in Supabase -- no INSERT/UPDATE/
-- DELETE policy is granted to `authenticated` on either table).
create policy jurisdictions_select on jurisdictions
  for select to authenticated
  using (true);

create policy authorities_select on authorities
  for select to authenticated
  using (true);
