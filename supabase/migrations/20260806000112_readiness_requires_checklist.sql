-- An empty checklist no longer counts as complete for the Ready to submit
-- gate (transition_permit_status() Check 5, 025/061).
-- readiness_checklist_complete() used to return true when an application had
-- no required items at all (the "vacuously ready" judgment call flagged in
-- 025), so a brand-new application could move to Ready to submit with no
-- checklist. It now also needs at least one required item. A readiness
-- override (override_readiness_check()) still lets an application through
-- without one, e.g. for a permit type with nothing to check.
--
-- compute_readiness_score() keeps its 0-required-items = 100 case; the
-- readiness panel already shows "No checklist yet" for it. Only
-- transition_permit_status() calls this function. CREATE OR REPLACE keeps
-- the existing grants.
--
-- Rollback: re-create the 025 definition (the not exists query alone).

create or replace function readiness_checklist_complete(p_application_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from readiness_checklist_items
    where application_id = p_application_id
      and is_required
  ) and not exists (
    select 1 from readiness_checklist_items
    where application_id = p_application_id
      and is_required
      and status <> 'complete'
  );
$$;
