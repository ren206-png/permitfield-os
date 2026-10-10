-- Vancouver Commercial Tenant Improvement: two items missing from migration
-- 080's transcription of the City's "Commercial Building Renovation --
-- Building Permit Application Requirements" (DOC/2022/227241, updated March
-- 2026), found when the list was re-checked against the source on 2026-10-09:
--
--   - "Architectural Cross Section" is listed with no condition, and the
--     checklist says every item is required "unless otherwise noted".
--   - "Architectural Exterior Elevations" (new or altered exhaust louvers,
--     rooftop units, windows, cladding) and "Architectural Roof Plans" (roof
--     alterations or new mechanical units) are conditional.
--
-- Both go in at their place in the checklist's order (after the floor plans,
-- and after the ceiling plans); later items move down. Pending review like
-- the rest.

do $$
declare
  v_type constant uuid := '00000000-0000-0000-0003-000000000004';
  v_jurisdiction constant uuid := '00000000-0000-0000-0001-000000000006';
  v_source constant uuid := '00000000-0000-0000-0005-000000000004';
begin
  if exists (select 1 from permit_requirements where permit_type_id = v_type and title = 'Architectural cross sections') then
    return;
  end if;

  -- Floor plans are 7 and ceiling plans 11 in migration 080's order.
  update permit_requirements set display_order = display_order + 2
  where permit_type_id = v_type and display_order >= 12;
  update permit_requirements set display_order = display_order + 1
  where permit_type_id = v_type and display_order between 8 and 11;

  insert into permit_requirements
    (jurisdiction_id, permit_type_id, source_id, verification_status, display_order, title, description, applies_when)
  values
    (v_jurisdiction, v_type, v_source, 'pending_review', 8, 'Architectural cross sections',
     'Wall, floor, roof and ceiling assemblies, fire-resistance ratings and fire stopping of required fire separations, stair, guard and handrail details, and ceiling heights.',
     null),
    (v_jurisdiction, v_type, v_source, 'pending_review', 13, 'Exterior elevations and roof plan',
     'Elevations showing the new or altered exterior elements; a roof plan with rooftop units, their setbacks from roof edges and anchorage.',
     'Required if exhaust louvers, rooftop units, windows or cladding are new or altered, or the roof is altered.');
end $$;
