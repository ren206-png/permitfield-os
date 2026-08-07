-- 3.10 / 3.11. Audits are append-only (the current audit is the newest row for
-- an application, never an overwritten column -- SS3.10). audit_findings rows
-- are append-only on creation but review_status/reviewed_by/reviewed_at must
-- stay mutable so a contractor can Confirm/Dismiss a finding (SS4.5) -- and per
-- adversarial check #10, a dismissal must survive a subsequent audit re-run,
-- which it does here because it's a property of the OLD audit's finding row,
-- not something the new audit run touches.

create table audits (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references permit_applications(id) on delete cascade,
  model_id text not null,
  prompt_version text not null,
  corpus_version text not null,
  created_at timestamptz not null default now()
);

create index audits_application_id_idx on audits (application_id);

create type finding_kind as enum ('passed_check', 'missing_document', 'code_conflict');
create type finding_severity as enum ('critical', 'warning', 'info');
create type finding_review_status as enum ('unverified', 'confirmed', 'dismissed');

create table audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  kind finding_kind not null,
  severity finding_severity not null,
  issue text not null,
  action_required text not null,
  -- SS0.2: no citation, no finding. code_chunk_id may be null ONLY for
  -- missing_document findings (nothing to cite when the problem is an absent
  -- document, not a code conflict). The FK deliberately has no ON DELETE
  -- CASCADE/SET NULL override beyond the default RESTRICT: a code chunk that
  -- has been cited by a finding should not silently disappear from under it.
  code_chunk_id uuid references jurisdiction_code_chunks(id),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  review_status finding_review_status not null default 'unverified',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'missing_document' or code_chunk_id is not null),
  check ((review_status = 'unverified') = (reviewed_by is null)),
  check ((review_status = 'unverified') = (reviewed_at is null))
);

create index audit_findings_audit_id_idx on audit_findings (audit_id);
create index audit_findings_code_chunk_id_idx on audit_findings (code_chunk_id);

alter table audits enable row level security;
alter table audit_findings enable row level security;

create policy audits_select on audits
  for select to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = audits.application_id
        and is_org_member(pa.org_id)
    )
  );

create trigger audits_append_only
  before update or delete on audits
  for each row execute function forbid_update_delete();

create policy audit_findings_select on audit_findings
  for select to authenticated
  using (
    exists (
      select 1 from audits a
      join permit_applications pa on pa.id = a.application_id
      where a.id = audit_findings.audit_id
        and is_org_member(pa.org_id)
    )
  );

-- Contractors may update ONLY the review columns, on findings belonging to
-- their org's applications.
create policy audit_findings_review_update on audit_findings
  for update to authenticated
  using (
    exists (
      select 1 from audits a
      join permit_applications pa on pa.id = a.application_id
      where a.id = audit_findings.audit_id
        and is_org_member(pa.org_id)
    )
  )
  with check (
    exists (
      select 1 from audits a
      join permit_applications pa on pa.id = a.application_id
      where a.id = audit_findings.audit_id
        and is_org_member(pa.org_id)
    )
  );

create or replace function audit_findings_restrict_update()
returns trigger
language plpgsql
as $$
begin
  if OLD.audit_id is distinct from NEW.audit_id
     or OLD.kind is distinct from NEW.kind
     or OLD.severity is distinct from NEW.severity
     or OLD.issue is distinct from NEW.issue
     or OLD.action_required is distinct from NEW.action_required
     or OLD.code_chunk_id is distinct from NEW.code_chunk_id
     or OLD.confidence is distinct from NEW.confidence
     or OLD.created_at is distinct from NEW.created_at
  then
    raise exception 'audit_findings is append-only except for review_status/reviewed_by/reviewed_at';
  end if;
  return NEW;
end;
$$;

create trigger audit_findings_restrict_update_trigger
  before update on audit_findings
  for each row execute function audit_findings_restrict_update();

create or replace function forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows may never be deleted', TG_TABLE_NAME;
end;
$$;

create trigger audit_findings_no_delete
  before delete on audit_findings
  for each row execute function forbid_delete();
