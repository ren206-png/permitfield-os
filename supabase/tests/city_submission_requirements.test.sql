-- Per-city submission requirements / 20260806000080_city_submission_requirements.sql.
-- Proves every listed permit type has its city checklist on file, every item
-- points at a source page, nothing claims to be verified before a named
-- reviewer has checked it, and a member can read the items and their source
-- (the "Add suggested items" button runs as the member).

begin;

do $$
declare
  v_missing text;
  v_bad integer;
begin
  select string_agg(j.municipality || ' / ' || pt.title, ', ') into v_missing
  from permit_types pt
  join jurisdictions j on j.id = pt.jurisdiction_id
  where pt.id between '00000000-0000-0000-0003-000000000001' and '00000000-0000-0000-0003-00000000000c'
    and not exists (select 1 from permit_requirements pr where pr.permit_type_id = pt.id and pr.archived_at is null);
  if v_missing is not null then
    raise exception 'FAIL: permit types without city requirements: %', v_missing;
  end if;
  raise notice 'PASS: all 12 permit types have city requirements.';

  select count(*) into v_bad
  from permit_requirements pr
  left join jurisdiction_sources s on s.id = pr.source_id
  where pr.permit_type_id between '00000000-0000-0000-0003-000000000001' and '00000000-0000-0000-0003-00000000000c'
    and (s.id is null or s.url not like 'https://%' or s.jurisdiction_id <> pr.jurisdiction_id
         or pr.verification_status <> 'pending_review' or pr.display_order is null);
  if v_bad > 0 then
    raise exception 'FAIL: % requirement rows lack an https source in their own jurisdiction, a display order, or pending_review', v_bad;
  end if;
  raise notice 'PASS: every requirement has its source, order, and is pending review.';

  select count(*) into v_bad
  from (
    select permit_type_id, display_order from permit_requirements
    where archived_at is null and display_order is not null
    group by 1, 2 having count(*) > 1
  ) dupes;
  if v_bad > 0 then
    raise exception 'FAIL: % duplicate display_order values within a permit type', v_bad;
  end if;
  raise notice 'PASS: display_order is unique within each permit type.';
end $$;

-- A blank condition is rejected (it would make a required item optional with no reason shown).
do $$
begin
  begin
    update permit_requirements set applies_when = '  '
    where permit_type_id = '00000000-0000-0000-0003-000000000004' and display_order = 1;
    raise exception 'FAIL: a blank applies_when was accepted';
  exception when check_violation then
    raise notice 'PASS: a blank applies_when is rejected.';
  end;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from permit_requirements pr
  join jurisdiction_sources s on s.id = pr.source_id
  where pr.permit_type_id = '00000000-0000-0000-0003-000000000004';
  if v_count = 0 then
    raise exception 'FAIL: an authenticated user cannot read Vancouver''s requirements with their source';
  end if;
  raise notice 'PASS: an authenticated user reads % Vancouver requirements with their source.', v_count;
end $$;

rollback;
