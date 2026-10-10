-- Re-check of the city requirements against their sources (2026-10-09). Every
-- source is still the version migration 080 transcribed (Surrey July 2025,
-- Edmonton v3 2026-09-01, Coquitlam Doc 3949561.v4, Richmond PL-43 rev.
-- Feb 17 2026, Maple Ridge revised 2025-04-28, Calgary's requirement list,
-- Hamilton's page, Port Coquitlam's page, ESA's forms page). Items 080 left
-- out that apply to a commercial interior alteration are added here, at the
-- end of each list, pending review. Coquitlam, Edmonton, Hamilton and ESA had
-- nothing missing; Ottawa's page could not be re-read (its bot protection
-- blocked the request) and is unchanged.

create function pg_temp.append_requirements(p_permit_type_id uuid, p_items jsonb) returns void
language plpgsql as $$
declare
  v_jurisdiction uuid;
  v_source uuid;
  v_next integer;
begin
  select pr.jurisdiction_id, pr.source_id, coalesce(max(pr.display_order) over (), 0) + 1
    into v_jurisdiction, v_source, v_next
  from permit_requirements pr
  where pr.permit_type_id = p_permit_type_id
  order by pr.display_order desc
  limit 1;
  if v_source is null then
    return;
  end if;
  insert into permit_requirements
    (jurisdiction_id, permit_type_id, source_id, verification_status, display_order, title, description, applies_when)
  select v_jurisdiction, p_permit_type_id, v_source, 'pending_review', v_next + item.ordinality::integer - 1,
         item.value->>'title', item.value->>'description', item.value->>'when'
  from jsonb_array_elements(p_items) with ordinality as item
  where not exists (
    select 1 from permit_requirements x where x.permit_type_id = p_permit_type_id and x.title = item.value->>'title'
  );
end;
$$;

-- Surrey (tenant & landlord improvement checklist, July 2025)
select pg_temp.append_requirements('00000000-0000-0000-0003-000000000003', $json$[
  {"title": "Electrical drawings", "description": "Electrical plans for the work.", "when": "If there is electrical work; depending on the use, they may need a Registered Professional's seal."},
  {"title": "Fire sprinkler plans", "description": "Reviewed as part of the building permit; Surrey's Fire Sprinkler Permit page says when a Registered Professional is required.", "when": "If sprinklers are added or altered."},
  {"title": "Architectural drawings by a Registered Architect", "description": "Sealed by the architect.", "when": "Required when the project falls under the AIBC Reserved Practice of Architecture bulletin."},
  {"title": "Letter from the base building's Coordinating Registered Professional", "description": "Or use the same registered professionals as the base building.", "when": "If the base building permit does not have final approval."},
  {"title": "Title search", "description": "A current title search.", "when": "If the City asks: when the owner's details on your documents don't match its records."}
]$json$::jsonb);

-- Calgary (Interior Partitioning requirement list)
select pg_temp.append_requirements('00000000-0000-0000-0003-000000000002', $json$[
  {"title": "Specifications (1 set)", "description": "Project specifications.", "when": "If applicable."},
  {"title": "Interior Partition Demolition Partial Permit Application Form", "description": "Completed form.", "when": "If you are applying for a partial permit."}
]$json$::jsonb);

-- Port Coquitlam (Tenant Improvement page)
select pg_temp.append_requirements('00000000-0000-0000-0003-000000000007', $json$[
  {"title": "Contractor's Port Coquitlam business licence", "description": "The builder contractor needs a valid City of Port Coquitlam business licence before the permit can be issued."},
  {"title": "Parking calculation", "description": "Under the Parking and Development Management Bylaw.", "when": "If applicable."}
]$json$::jsonb);

-- Maple Ridge (Landlord/Tenant Improvement checklist, revised 2025-04-28)
select pg_temp.append_requirements('00000000-0000-0000-0003-000000000008', $json$[
  {"title": "Alternate solution proposal", "description": "A sealed PDF version is required once accepted.", "when": "If you propose an alternate solution to the BC Building Code."}
]$json$::jsonb);

-- Richmond (PL-43 Part D, rev. Feb 17, 2026)
select pg_temp.append_requirements('00000000-0000-0000-0003-000000000005', $json$[
  {"title": "Zoning Regulation Summary Form (PL-46)", "description": "All zoning information complete and accurate."},
  {"title": "Equivalency report and Alternative Solutions Application Form", "description": "A Registered Professional's report showing the alternative meets or exceeds the code; the alternative solution fee follows submission.", "when": "If an alternative solution is proposed."},
  {"title": "Site Disclosure Statement", "description": "The Ministry of Environment and Climate Change Strategy's Site Disclosure Statement.", "when": "Listed in PL-43 without a condition; ask Richmond whether your alteration needs it."},
  {"title": "Traffic management plan", "description": "Where loading and unloading happen and where trucks wait; nothing stored on City rights of way.", "when": "Listed in PL-43 without a condition; ask Richmond whether your alteration needs it."}
]$json$::jsonb);
