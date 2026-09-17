-- Gate 5, sub-phase 5.2 ("Service layer + Inngest function(s)") --
-- GATE_5_FINDINGS.md §K. Additive-only, per this repo's standing migration
-- convention: no existing table, column, or enum value altered or removed.
--
-- "Never silently discard a rejected finding" (SS6 hallucination-rate
-- metric, mirrored from ai_findings_rejected -- 20260806000010): a drawing
-- finding that fails the citation check or Zod schema validation must be
-- persisted somewhere, not dropped, so the citation-validity-rate metric can
-- actually be measured for this pipeline too. This is a dedicated sibling
-- table to ai_findings_rejected rather than a reuse of it -- ai_findings_rejected's
-- own audit_id column has no FK (deliberate, per that migration), and a
-- drawing_review_id is a different, unrelated kind of run id; giving this
-- workstream its own table avoids overloading one column for two distinct
-- source-run concepts.
--
-- Shape mirrors ai_findings_rejected exactly:
--   - internal ops table, RLS enabled, zero policies (default-deny for
--     `authenticated`/`anon`; only service_role, granted explicitly below,
--     can touch it).
--   - drawing_review_id uuid, deliberately NOT a foreign key -- same
--     reasoning as ai_findings_rejected.audit_id: a rejected finding can be
--     produced by an attempt whose drawing_reviews row was never inserted at
--     all (e.g. the whole response failed structural validation, the
--     fail-closed path in lib/inngest/functions/drawing-review.ts), so a
--     hard FK would force a fabricated or nullable-then-immediately-null
--     reference for exactly the cases this table exists to capture.
--   - application_document_id uuid references application_documents(id) on
--     delete set null -- mirrors ai_findings_rejected.application_id's own
--     "on delete set null" (the rejection record outlives the document
--     reference disappearing, same as it outlives the review disappearing).
create table drawing_findings_rejected (
  id uuid primary key default gen_random_uuid(),
  drawing_review_id uuid,
  application_document_id uuid references application_documents(id) on delete set null,
  raw_finding jsonb not null,
  rejection_reason text not null,
  model_id text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create index drawing_findings_rejected_application_document_id_idx
  on drawing_findings_rejected (application_document_id);

alter table drawing_findings_rejected enable row level security;
-- No policies: default-deny for `authenticated`/`anon`, same as
-- ai_findings_rejected -- only service_role (the drawing-review pipeline
-- writing rejections, and the eval harness reading them) can touch this
-- table.

-- INSERT ONLY, no SELECT -- exact precedent confirmed via
-- 20260806000015_service_role_grants.sql:48
-- (`grant insert on ai_findings_rejected to service_role;`). INSERT ...
-- RETURNING needs no separate SELECT privilege, so service_role has no
-- legitimate need to read this table back; a future eval/reporting need can
-- add SELECT explicitly when it actually exists, same "explicit grants only"
-- discipline as every other table in this codebase.
grant insert on drawing_findings_rejected to service_role;

-- Close the same Supabase-platform-default service_role TRUNCATE gap this
-- migration's siblings close proactively (20260806000033's lesson) --
-- TRUNCATE bypasses RLS entirely and there is no row-level trigger on this
-- table to intercept it.
revoke truncate on drawing_findings_rejected from service_role;
