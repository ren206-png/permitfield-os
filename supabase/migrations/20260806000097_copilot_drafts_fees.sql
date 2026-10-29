-- Gate 6, sub-phase 6.5: application drafts (cover letters, correction
-- responses), recorded correction requests, fee-estimate snapshots, and
-- fee-schedule publication (GATE_6_STATUS.md § 6.5; master prompt §14-§16).
--
-- All three new tables are append-only ledgers:
--   * application_draft_versions -- every save of a draft is a new version.
--     (thread_id, version) is unique, so two people saving the same draft
--     from the same base collide (unique_violation) instead of silently
--     overwriting each other: optimistic concurrency. Whether an AI
--     regeneration may replace a human edit is decided by the app before
--     it writes (lib/drafts/versions.ts); the ledger keeps both regardless.
--   * correction_requests -- what an authority asked to be corrected, as
--     recorded by staff, with the document it arrived in.
--   * fee_estimates -- each computed estimate, kept for reconciliation
--     (§16 "estimate snapshots preserved"); written only by the server.
-- publish_fee_schedule_version() publishes an immutable fee schedule
-- (fee_schedule_versions, 6.1) for a platform admin, only from a PUBLISHED
-- source revision of the same jurisdiction.
--
-- Rollback (reverse order; valid while nothing references these):
--   drop function if exists publish_fee_schedule_version(uuid, uuid, char, fee_rounding_rule, date, date, jsonb, uuid);
--   drop table if exists fee_estimates, application_draft_versions, correction_requests;
--   drop type if exists fee_estimate_status, draft_origin, draft_kind;

create type draft_kind as enum ('cover_letter', 'correction_response');
create type draft_origin as enum ('ai_generated', 'human_edited');
create type fee_estimate_status as enum ('estimated', 'missing_inputs', 'stale_schedule', 'authority_quote_required', 'unavailable');

-- ---------------------------------------------------------------------------
-- correction_requests
-- ---------------------------------------------------------------------------
create table correction_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  received_on date not null,
  -- The authority's items, one entry per thing to correct, as written.
  items jsonb not null check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100
  ),
  reference text check (length(reference) <= 200),
  -- The letter/notice it arrived in, when uploaded. No FK, same reason as
  -- project_facts.source_document_id (documents can be deleted).
  evidence_document_id uuid,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade
);

create index correction_requests_application_idx on correction_requests (org_id, application_id, created_at desc);

-- ---------------------------------------------------------------------------
-- application_draft_versions
-- ---------------------------------------------------------------------------
create table application_draft_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  -- One thread per draft (e.g. "the cover letter", "the response to the
  -- 2026-11-03 correction request"); versions count up within it.
  thread_id uuid not null,
  kind draft_kind not null,
  correction_request_id uuid references correction_requests(id) on delete cascade,
  version integer not null check (version >= 1),
  -- The version this one was written from; null only for version 1.
  based_on_version integer check (based_on_version >= 1),
  origin draft_origin not null,
  body text not null check (length(body) between 1 and 50000),
  -- Citations an AI version was checked against ([{evidence_id, quote, ...}]).
  citations jsonb not null default '[]' check (jsonb_typeof(citations) = 'array'),
  model_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade,
  unique (thread_id, version),
  constraint application_draft_versions_lineage check (
    (version = 1 and based_on_version is null) or (version > 1 and based_on_version = version - 1)
  ),
  constraint application_draft_versions_correction_kind check (
    (kind = 'correction_response') = (correction_request_id is not null)
  ),
  constraint application_draft_versions_ai_has_model check (
    origin <> 'ai_generated' or model_id is not null
  )
);

create index application_draft_versions_application_idx
  on application_draft_versions (org_id, application_id, thread_id, version desc);

-- ---------------------------------------------------------------------------
-- fee_estimates
-- ---------------------------------------------------------------------------
create table fee_estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  fee_schedule_version_id uuid references fee_schedule_versions(id) on delete restrict,
  status fee_estimate_status not null,
  -- Integer minor units (cents). Null unless status = 'estimated'.
  total_minor bigint check (total_minor >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  -- Itemized lines, inputs used, missing inputs, exclusions, assumptions.
  calculation jsonb not null check (jsonb_typeof(calculation) = 'object'),
  engine_version text not null,
  computed_by uuid references auth.users(id),
  computed_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade,
  constraint fee_estimates_total_iff_estimated check (
    (status = 'estimated') = (total_minor is not null and currency is not null)
  ),
  constraint fee_estimates_schedule_unless_unavailable check (
    status = 'unavailable' or fee_schedule_version_id is not null
  )
);

create index fee_estimates_application_idx on fee_estimates (org_id, application_id, computed_at desc);

-- ---------------------------------------------------------------------------
-- RLS, append-only, grants
-- ---------------------------------------------------------------------------
alter table correction_requests enable row level security;
alter table application_draft_versions enable row level security;
alter table fee_estimates enable row level security;

create policy correction_requests_select on correction_requests
  for select to authenticated using (is_org_member(org_id));
create policy correction_requests_insert on correction_requests
  for insert to authenticated with check (is_org_member(org_id) and recorded_by = auth.uid());

create policy application_draft_versions_select on application_draft_versions
  for select to authenticated using (is_org_member(org_id));
create policy application_draft_versions_insert on application_draft_versions
  for insert to authenticated with check (is_org_member(org_id) and created_by = auth.uid());

-- Estimates are computed by the server; members read them.
create policy fee_estimates_select on fee_estimates
  for select to authenticated using (is_org_member(org_id));

create trigger correction_requests_append_only
  before update or delete on correction_requests
  for each row execute function forbid_update_delete();
create trigger application_draft_versions_append_only
  before update or delete on application_draft_versions
  for each row execute function forbid_update_delete();
create trigger fee_estimates_append_only
  before update or delete on fee_estimates
  for each row execute function forbid_update_delete();

revoke all on correction_requests, application_draft_versions, fee_estimates from anon, authenticated, service_role;
grant select, insert on correction_requests, application_draft_versions to authenticated, service_role;
grant select on fee_estimates to authenticated;
grant select, insert on fee_estimates to service_role;

-- ---------------------------------------------------------------------------
-- publish_fee_schedule_version (platform admins)
-- ---------------------------------------------------------------------------
-- Parameters are validated by the app (lib/fees/schedule.ts, Zod) before
-- the call; the database checks what it can know: admin, permit type in the
-- jurisdiction, the source revision is published and belongs to a source of
-- the same jurisdiction, and the version number.
create function publish_fee_schedule_version(
  p_jurisdiction_id uuid,
  p_permit_type_id uuid,
  p_currency char(3),
  p_rounding_rule fee_rounding_rule,
  p_effective_from date,
  p_effective_to date,
  p_parameters jsonb,
  p_source_revision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_previous fee_schedule_versions%rowtype;
  v_id uuid;
begin
  if v_actor is null or not is_platform_admin() then
    raise exception 'only a platform admin can publish a fee schedule' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from permit_types where id = p_permit_type_id and jurisdiction_id = p_jurisdiction_id) then
    raise exception 'permit type % does not belong to jurisdiction %', p_permit_type_id, p_jurisdiction_id
      using errcode = 'foreign_key_violation';
  end if;
  if not exists (
    select 1 from source_revisions sr
    join jurisdiction_sources js on js.id = sr.source_id
    where sr.id = p_source_revision_id and js.jurisdiction_id = p_jurisdiction_id
      and source_revision_is_published(sr.id)
  ) then
    raise exception 'source revision % is not a published revision of a source in this jurisdiction', p_source_revision_id
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('fee_schedule:' || p_jurisdiction_id::text || ':' || p_permit_type_id::text));

  select * into v_previous from fee_schedule_versions
    where jurisdiction_id = p_jurisdiction_id and permit_type_id = p_permit_type_id and authority_id is null
    order by version desc limit 1;

  insert into fee_schedule_versions (jurisdiction_id, authority_id, permit_type_id, version, currency, rounding_rule,
    effective_from, effective_to, parameters, source_revision_id, supersedes_fee_schedule_id, published_by)
  values (p_jurisdiction_id, null, p_permit_type_id, coalesce(v_previous.version, 0) + 1, p_currency, p_rounding_rule,
    p_effective_from, p_effective_to, p_parameters, p_source_revision_id, v_previous.id, v_actor)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function publish_fee_schedule_version(uuid, uuid, char, fee_rounding_rule, date, date, jsonb, uuid) from public, anon;
grant execute on function publish_fee_schedule_version(uuid, uuid, char, fee_rounding_rule, date, date, jsonb, uuid) to authenticated;
