-- Gate 2.0 sub-phase 2.2 (GATE_2_0_SPEC.md §4, "audit_logs migration design
-- (Option 2, path b)"; scoped and reviewed in GATE_2_0_FINDINGS.md §I before
-- this branch). Widens audit_logs to accept an external (client-portal)
-- actor alongside its existing internal-staff actor shape, without
-- reshaping or restricting anything that already writes to this table.
--
-- Current schema (20260806000018, confirmed unchanged since -- GATE_2_0_FINDINGS.md
-- §I.1 re-verified this directly before writing this migration):
--   actor_user_id uuid not null references auth.users(id)
--   actor_role    org_role not null
-- Both NOT NULL, because until now every audit_logs row described an
-- internal staff action. A client-portal actor (§2's client_access_tokens)
-- has no row in this project's auth.users at all -- it lives entirely in
-- the second, separate Supabase project -- so it cannot satisfy either
-- column. This migration widens the actor shape to admit that second case
-- structurally, via CHECK, rather than relaxing the columns with nothing
-- enforcing which combinations are legal.
alter table audit_logs alter column actor_user_id drop not null;
alter table audit_logs alter column actor_role drop not null;

-- Non-FK by necessity -- the referenced identity (a client_access_tokens
-- row) lives in the second project; a `references` clause here cannot
-- point at another Postgres instance, same cross-project reasoning as §2's
-- application_id/org_id pointers. external_actor_label is a denormalized
-- snapshot of the recipient identity at write time (recipient_email_display/
-- recipient_name, not the normalized recipient_email), so an audit_logs row
-- stays human-readable even if the second project's token row is later
-- deleted or rotated -- audit_logs never re-derives a live join back to
-- project 2 to render itself, matching how before_summary/after_summary
-- already snapshot state rather than re-querying it.
alter table audit_logs add column external_actor_id text;
alter table audit_logs add column external_actor_label text;

-- actor_role must travel with actor_user_id, not float free -- dropping
-- not null on both columns above without also tying them together here
-- would leave a row with actor_user_id populated and actor_role null as
-- legal, silently losing the role attribution every internal audit row has
-- always carried. Both internal columns are required together, both
-- external columns are required together, never a mix.
alter table audit_logs add constraint audit_logs_actor_exactly_one_populated
  check (
    (actor_user_id is not null and actor_role is not null and external_actor_id is null)
    or
    (actor_user_id is null and actor_role is null and external_actor_id is not null)
  );

alter table audit_logs add constraint audit_logs_external_actor_label_requires_id
  check (external_actor_label is null or external_actor_id is not null);

-- This migration is additive and non-behavior-changing for every existing
-- row: actor_user_id was already NOT NULL before this migration ran, so
-- every row already satisfies the internal-actor branch of the new CHECK
-- by construction -- not by inspecting live data (GATE_2_0_FINDINGS.md
-- §I.2). The pre-existing audit_logs_insert RLS policy
-- (`is_org_member(org_id) and actor_user_id = auth.uid()`) is untouched:
-- external-actor rows are never written by an `authenticated` session
-- (clients never hold one under Option 2), only by the second project's
-- bridge layer running as its own service_role, which is a different
-- project's credential entirely and does not write to this table via this
-- policy at all -- future work (§4's "does this gate wire up
-- writeAuditLog()" section), not this migration.
--
-- GATE_2_0_FINDINGS.md §I.3 re-confirmed two existing security-definer
-- writers (override_readiness_check(), review_project_permit_requirement())
-- insert into audit_logs directly, bypassing audit_logs_insert entirely,
-- and always populate actor_user_id/actor_role together -- neither can
-- ever land in a state this CHECK rejects. Sanity-checked below rather
-- than merely asserted in a comment.
do $$
declare
  v_violating_count int;
begin
  select count(*) into v_violating_count
  from audit_logs
  where not (
    (actor_user_id is not null and actor_role is not null and external_actor_id is null)
    or
    (actor_user_id is null and actor_role is null and external_actor_id is not null)
  );
  if v_violating_count <> 0 then
    raise exception 'audit_logs_actor_exactly_one_populated sanity check failed: % existing row(s) would violate the new CHECK', v_violating_count;
  end if;
end $$;
