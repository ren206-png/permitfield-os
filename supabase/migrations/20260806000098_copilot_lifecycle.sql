-- Gate 6, sub-phase 6.6: permit lifecycle evidence, conditions, inspections
-- and submission packages (GATE_6_STATUS.md § 6.6; master prompt §14, §15).
--
-- Extends the existing status machine (permit_status_enum,
-- transition_permit_status(), application_status_history -- 20260806000022/
-- 061) instead of adding a parallel one:
--   * permit_status_observations -- every status an authority reported, in
--     its ORIGINAL wording, with where it came from (authority letter, staff
--     report, a connector, an AI suggestion), when it was true, and what
--     happened to it. record_status_observation() applies a staff-recorded
--     observation through transition_permit_status() (same role tiers), but
--     an observation dated BEFORE the newest applied one is kept as 'stale'
--     and never changes the status: a late/queued update cannot override a
--     newer one. Connector events and AI suggestions are recorded only.
--   * permit_conditions / permit_condition_events -- conditions of the
--     permit and their satisfied / waived / reopened history.
--   * inspection_records -- inspections with provenance; a result (passed,
--     failed, partial) cannot be recorded before the permit is issued.
--   * submission_packages / submission_package_approvals -- an immutable
--     manifest of exactly what is being submitted (form revisions,
--     attachment hashes, fact and checklist snapshots, open items). An
--     internal approval is a separate row and never changes permit_status.
-- All seven tables are append-only.
--
-- Rollback (reverse order; valid while nothing references these):
--   drop function if exists record_connector_status_event(text, text, uuid, text, permit_status_enum, timestamptz);
--   drop function if exists record_status_observation(uuid, status_evidence_source, text, permit_status_enum, timestamptz, uuid, text, uuid);
--   drop table if exists submission_package_approvals, submission_packages, inspection_records,
--     permit_condition_events, permit_conditions, permit_status_observations;
--   drop function if exists inspection_requires_issued_permit();
--   drop type if exists inspection_provenance, inspection_outcome, condition_event_status,
--     condition_category, status_observation_outcome, status_evidence_source;

create type status_evidence_source as enum ('authority_correspondence', 'user_reported', 'connector', 'ai_suggestion');
create type status_observation_outcome as enum ('applied', 'already_current', 'stale', 'not_applied_invalid', 'recorded_only');
create type condition_category as enum ('before_issuance', 'during_construction', 'before_occupancy', 'inspection', 'other');
create type condition_event_status as enum ('satisfied', 'waived_by_authority', 'reopened');
create type inspection_outcome as enum ('scheduled', 'passed', 'failed', 'partial', 'cancelled');
create type inspection_provenance as enum ('authority_record', 'user_reported');

-- ---------------------------------------------------------------------------
-- permit_status_observations
-- ---------------------------------------------------------------------------
create table permit_status_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  source status_evidence_source not null,
  -- The authority's own words ("Permit issued -- conditions apply").
  external_status text not null check (length(btrim(external_status)) between 1 and 500),
  -- Our mapping of it; null when it doesn't map to a permit_status_enum value.
  observed_status permit_status_enum,
  -- When the status was true at the authority (the letter's date, the
  -- portal timestamp), as opposed to when it was recorded here.
  observed_at timestamptz not null,
  evidence_document_id uuid,
  external_reference text check (length(external_reference) <= 200),
  connector_name text check (connector_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  connector_event_id text check (length(connector_event_id) between 1 and 200),
  outcome status_observation_outcome not null,
  outcome_detail text check (length(outcome_detail) <= 500),
  -- The application_status_history row the transition wrote. Set only by
  -- record_status_observation. Deliberately no foreign key: an FK from one
  -- append-only ledger to another blocks maintenance on the referenced one
  -- (e.g. the TRUNCATE control in service_role_truncate_append_only.test.sql),
  -- the same reasoning as project_facts.source_document_id.
  applied_history_id uuid,
  request_key uuid,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade,
  constraint permit_status_observations_connector_identity check (
    (source = 'connector') = (connector_name is not null and connector_event_id is not null)
  ),
  constraint permit_status_observations_people_have_author check (
    source not in ('authority_correspondence', 'user_reported') or recorded_by is not null
  ),
  -- Only staff-recorded evidence can change the status.
  constraint permit_status_observations_machine_never_applied check (
    source in ('authority_correspondence', 'user_reported') or outcome in ('recorded_only', 'stale')
  ),
  constraint permit_status_observations_applied_has_history check (
    (outcome = 'applied') = (applied_history_id is not null)
  )
);

create unique index permit_status_observations_connector_event
  on permit_status_observations (connector_name, connector_event_id) where connector_event_id is not null;
create unique index permit_status_observations_request_key
  on permit_status_observations (org_id, application_id, request_key) where request_key is not null;
create index permit_status_observations_application_idx
  on permit_status_observations (org_id, application_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- permit_conditions / permit_condition_events
-- ---------------------------------------------------------------------------
create table permit_conditions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  condition_text text not null check (length(btrim(condition_text)) between 1 and 4000),
  category condition_category not null,
  source status_evidence_source not null check (source in ('authority_correspondence', 'user_reported')),
  evidence_document_id uuid,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade
);

create index permit_conditions_application_idx on permit_conditions (org_id, application_id);

create table permit_condition_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  condition_id uuid not null references permit_conditions(id) on delete cascade,
  status condition_event_status not null,
  evidence_document_id uuid,
  note text check (length(note) <= 2000),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  -- Waivers are the authority's decision: say who and when.
  constraint permit_condition_events_waiver_note check (status <> 'waived_by_authority' or note is not null),
  constraint permit_condition_events_satisfied_basis check (
    status <> 'satisfied' or evidence_document_id is not null or note is not null
  )
);

create index permit_condition_events_condition_idx on permit_condition_events (condition_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- inspection_records
-- ---------------------------------------------------------------------------
create table inspection_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  inspection_type text not null check (length(btrim(inspection_type)) between 1 and 200),
  outcome inspection_outcome not null,
  occurred_on date not null,
  provenance inspection_provenance not null,
  evidence_document_id uuid,
  external_reference text check (length(external_reference) <= 200),
  notes text check (length(notes) <= 4000),
  supersedes_inspection_id uuid references inspection_records(id),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade,
  constraint inspection_records_not_self_superseding check (supersedes_inspection_id <> id)
);

create index inspection_records_application_idx on inspection_records (org_id, application_id, occurred_on desc);

-- Issuance comes before inspection results (master prompt §15: issuance is
-- not closure, and a result needs an issued permit to inspect against).
create function inspection_requires_issued_permit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.outcome in ('passed', 'failed', 'partial')
     and not exists (
       select 1 from permit_applications
       where id = new.application_id and permit_status in ('issued', 'expired', 'closed')
     ) then
    raise exception 'inspection_before_issuance: record the permit as issued before an inspection result'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger inspection_records_require_issued
  before insert on inspection_records
  for each row execute function inspection_requires_issued_permit();

-- ---------------------------------------------------------------------------
-- submission_packages / submission_package_approvals
-- ---------------------------------------------------------------------------
create table submission_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null,
  version integer not null check (version >= 1),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_sha256 char(64) not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  prepared_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (org_id, application_id) references permit_applications (org_id, id) on delete cascade,
  unique (application_id, version)
);

create table submission_package_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  package_id uuid not null unique references submission_packages(id) on delete cascade,
  note text check (length(note) <= 2000),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS, append-only, grants
-- ---------------------------------------------------------------------------
alter table permit_status_observations enable row level security;
alter table permit_conditions enable row level security;
alter table permit_condition_events enable row level security;
alter table inspection_records enable row level security;
alter table submission_packages enable row level security;
alter table submission_package_approvals enable row level security;

create policy permit_status_observations_select on permit_status_observations
  for select to authenticated using (is_org_member(org_id));
-- Writes only through record_status_observation() / the connector function.

create policy permit_conditions_select on permit_conditions for select to authenticated using (is_org_member(org_id));
create policy permit_conditions_insert on permit_conditions for insert to authenticated
  with check (is_org_member(org_id) and recorded_by = auth.uid());
create policy permit_condition_events_select on permit_condition_events for select to authenticated using (is_org_member(org_id));
create policy permit_condition_events_insert on permit_condition_events for insert to authenticated
  with check (
    is_org_member(org_id) and recorded_by = auth.uid()
    and exists (select 1 from permit_conditions c where c.id = condition_id and c.org_id = permit_condition_events.org_id)
  );
create policy inspection_records_select on inspection_records for select to authenticated using (is_org_member(org_id));
create policy inspection_records_insert on inspection_records for insert to authenticated
  with check (is_org_member(org_id) and recorded_by = auth.uid());
create policy submission_packages_select on submission_packages for select to authenticated using (is_org_member(org_id));
create policy submission_packages_insert on submission_packages for insert to authenticated
  with check (is_org_member(org_id) and prepared_by = auth.uid());
create policy submission_package_approvals_select on submission_package_approvals for select to authenticated using (is_org_member(org_id));
create policy submission_package_approvals_insert on submission_package_approvals for insert to authenticated
  with check (
    is_org_member(org_id) and approved_by = auth.uid()
    and exists (select 1 from submission_packages p where p.id = package_id and p.org_id = submission_package_approvals.org_id)
  );

create trigger permit_status_observations_append_only before update or delete on permit_status_observations
  for each row execute function forbid_update_delete();
create trigger permit_conditions_append_only before update or delete on permit_conditions
  for each row execute function forbid_update_delete();
create trigger permit_condition_events_append_only before update or delete on permit_condition_events
  for each row execute function forbid_update_delete();
create trigger inspection_records_append_only before update or delete on inspection_records
  for each row execute function forbid_update_delete();
create trigger submission_packages_append_only before update or delete on submission_packages
  for each row execute function forbid_update_delete();
create trigger submission_package_approvals_append_only before update or delete on submission_package_approvals
  for each row execute function forbid_update_delete();

revoke all on permit_status_observations, permit_conditions, permit_condition_events, inspection_records,
  submission_packages, submission_package_approvals from anon, authenticated, service_role;
grant select on permit_status_observations to authenticated, service_role;
grant select, insert on permit_conditions, permit_condition_events, inspection_records,
  submission_packages, submission_package_approvals to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_status_observation (staff)
-- ---------------------------------------------------------------------------
create function record_status_observation(
  p_application_id uuid,
  p_source status_evidence_source,
  p_external_status text,
  p_observed_status permit_status_enum,
  p_observed_at timestamptz,
  p_evidence_document_id uuid,
  p_external_reference text,
  p_request_key uuid
)
returns permit_status_observations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications;
  v_existing permit_status_observations;
  v_newest_applied timestamptz;
  v_outcome status_observation_outcome;
  v_detail text;
  v_history_id uuid;
  v_row permit_status_observations;
begin
  if p_source not in ('authority_correspondence', 'user_reported') then
    raise exception 'only staff-recorded evidence goes through this function' using errcode = 'invalid_parameter_value';
  end if;
  if p_request_key is null then
    raise exception 'a request key is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null or not is_org_member(v_app.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Idempotent: the same request recorded twice returns the first result.
  select * into v_existing from permit_status_observations
    where org_id = v_app.org_id and application_id = v_app.id and request_key = p_request_key;
  if found then
    return v_existing;
  end if;

  perform pg_advisory_xact_lock(hashtext('status_observation:' || v_app.id::text));

  -- The newest status this application is known to be in: applied, or
  -- confirmed as already current.
  select max(observed_at) into v_newest_applied from permit_status_observations
    where org_id = v_app.org_id and application_id = v_app.id and outcome in ('applied', 'already_current');

  if v_newest_applied is not null and p_observed_at < v_newest_applied then
    v_outcome := 'stale';
    v_detail := 'Older than the newest applied status (' || v_newest_applied::text || '); kept as history only.';
  elsif p_observed_status is null then
    v_outcome := 'recorded_only';
    v_detail := 'The authority''s wording does not map to a PermitField status.';
  elsif p_observed_status is not distinct from v_app.permit_status then
    v_outcome := 'already_current';
  else
    begin
      perform transition_permit_status(
        v_app.id, p_observed_status,
        left('Recorded from ' || replace(p_source::text, '_', ' ') || ': ' || p_external_status, 500),
        p_request_key);
      select id into v_history_id from application_status_history
        where org_id = v_app.org_id and application_id = v_app.id and request_key = p_request_key;
      v_outcome := 'applied';
    exception when invalid_parameter_value or raise_exception then
      -- 22023: not a legal transition from the current status, or the
      -- readiness gate; P0001: e.g. documents not submitted yet. Privilege
      -- (42501) and concurrency (40001) errors are not caught.
      v_outcome := 'not_applied_invalid';
      v_detail := left(sqlerrm, 500);
    end;
  end if;

  insert into permit_status_observations (org_id, application_id, source, external_status, observed_status, observed_at,
    evidence_document_id, external_reference, outcome, outcome_detail, applied_history_id, request_key, recorded_by)
  values (v_app.org_id, v_app.id, p_source, p_external_status, p_observed_status, p_observed_at,
    p_evidence_document_id, p_external_reference, v_outcome, v_detail, v_history_id, p_request_key, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_connector_status_event (service_role; contract only in 6.6)
-- ---------------------------------------------------------------------------
-- A connector's status callback, deduplicated on (connector, event id) and
-- ordered by observed_at. In 6.6 no connector is enabled, and connector
-- events never change the status by themselves.
create function record_connector_status_event(
  p_connector_name text,
  p_event_id text,
  p_application_id uuid,
  p_external_status text,
  p_observed_status permit_status_enum,
  p_observed_at timestamptz
)
returns permit_status_observations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app permit_applications;
  v_row permit_status_observations;
  v_newest timestamptz;
begin
  select * into v_row from permit_status_observations
    where connector_name = p_connector_name and connector_event_id = p_event_id;
  if found then
    return v_row; -- duplicate callback
  end if;
  select * into v_app from permit_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application % not found', p_application_id using errcode = 'no_data_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('status_observation:' || v_app.id::text));
  select max(observed_at) into v_newest from permit_status_observations
    where org_id = v_app.org_id and application_id = v_app.id and outcome in ('applied', 'recorded_only', 'already_current');
  insert into permit_status_observations (org_id, application_id, source, external_status, observed_status, observed_at,
    connector_name, connector_event_id, outcome, outcome_detail)
  values (v_app.org_id, v_app.id, 'connector', p_external_status, p_observed_status, p_observed_at, p_connector_name, p_event_id,
    case when v_newest is not null and p_observed_at < v_newest then 'stale'::status_observation_outcome else 'recorded_only'::status_observation_outcome end,
    'Connector event; connectors cannot change status in this release.')
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function record_status_observation(uuid, status_evidence_source, text, permit_status_enum, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function record_status_observation(uuid, status_evidence_source, text, permit_status_enum, timestamptz, uuid, text, uuid) to authenticated;
revoke execute on function record_connector_status_event(text, text, uuid, text, permit_status_enum, timestamptz) from public, anon, authenticated;
grant execute on function record_connector_status_event(text, text, uuid, text, permit_status_enum, timestamptz) to service_role;
revoke execute on function inspection_requires_issued_permit() from public, anon, authenticated;
