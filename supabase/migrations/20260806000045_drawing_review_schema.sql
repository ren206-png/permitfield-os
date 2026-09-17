-- Gate 5, sub-phase 5.1 ("Schema & RLS") -- GATE_5_FINDINGS.md §K. Additive
-- only, per this repo's standing migration convention: no existing table,
-- column, or enum value is altered or removed.
--
-- CORRECTING GATE_5_FINDINGS.md's OWN §K PLAN: that doc proposed a
-- standalone drawing-review ledger. Mid-implementation, re-reading
-- 20260806000036_ai_jobs_token_ledger_human_reviews.sql and
-- 20260806000038_application_document_chunks.sql (both already merged to
-- main via 4e76a0d, Gate AI-1 sub-phases AI-1.1/AI-1.2 -- which the Gate 5
-- Phase 0 pass had incorrectly characterized as "scoping-only, blocked")
-- showed that job/cost tracking for exactly this kind of AI task already
-- exists. This migration reuses that ledger (ai_jobs, extended with a new
-- task kind below) rather than duplicating model_id/token-count columns a
-- third time -- extractions and audits each keep their own, predating
-- ai_jobs; this is the first table built AFTER ai_jobs existed, so it uses
-- it from day one, which is exactly what ai_task_kind's extensibility
-- (`alter type ... add value`, same convention as org_role) was declared
-- for.
--
-- Two new tables here, mirroring the existing extractions -> audits/
-- audit_findings shape (20260806000007, 20260806000009) applied to a
-- drawing document instead of the application as a whole:
--   - drawing_reviews:  one row per AI pass over one application_document
--     (append-only, siblings extractions/audits).
--   - drawing_findings: one row per finding from that pass, citing BOTH a
--     jurisdiction_code_chunks row (the rule -- reusing audit_findings'
--     own finding_kind/finding_severity/finding_review_status enums rather
--     than inventing near-duplicates) AND a page/region location on the
--     drawing itself (the NEW evidence-linking Gate 5 asks for: source_page/
--     source_region generalize what extractions.parsed_data's per-field
--     source_page already does for text documents, to a visual citation on
--     a drawing sheet). "No citation, no finding" (audit_findings' own
--     SS0.2 doctrine, 20260806000009) now means both citations are missing
--     is a CHECK violation, not just one.
--
-- Extraction-side structured values (dimensions, setbacks, etc. read off a
-- drawing) are deliberately NOT a new table in this migration -- per
-- GATE_5_FINDINGS.md §D.5, that shape (value/confidence/source_document_id/
-- source_page, generalized with a source_region) already fits inside
-- extractions.parsed_data's existing jsonb column and a new Zod schema, a
-- 5.2 (service-layer) concern, not a 5.1 (schema) one. This migration adds
-- no column to extractions.
create table drawing_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references permit_applications(id) on delete cascade,
  -- Which drawing sheet this pass reviewed. application_documents has no
  -- CHECK restricting this to doc_kind = 'blueprint' -- Postgres CHECK
  -- constraints can't reference another table's column, and a trigger for
  -- this single invariant was judged not worth the complexity Gate 5.2's
  -- service layer is the enforcement point, same "app code enforces what
  -- the DB structurally can't" reasoning as extractions never having
  -- restricted which application_documents rows it may cite.
  application_document_id uuid not null references application_documents(id) on delete cascade,
  -- Reuses the AI-1.1 ledger instead of duplicating model_id/prompt_version/
  -- token-count columns a third time (see header). on delete cascade: an
  -- ai_jobs row only ever disappears via its owning organization's own
  -- cascade delete, at which point every drawing_reviews row under the same
  -- org is being removed anyway.
  ai_job_id uuid not null references ai_jobs(id) on delete cascade,
  -- Which jurisdiction_code_chunks snapshot this pass retrieved against --
  -- same field, same purpose as audits.corpus_version.
  corpus_version text not null,
  created_at timestamptz not null default now()
);

create index drawing_reviews_application_id_idx on drawing_reviews (application_id);
create index drawing_reviews_application_document_id_idx on drawing_reviews (application_document_id);
create index drawing_reviews_ai_job_id_idx on drawing_reviews (ai_job_id);

create table drawing_findings (
  id uuid primary key default gen_random_uuid(),
  drawing_review_id uuid not null references drawing_reviews(id) on delete cascade,
  -- Reuses audit_findings' own enums rather than declaring near-duplicates --
  -- a "passed check" / "missing document" / "code conflict" taxonomy is not
  -- specific to text-document audits, it applies unchanged to a drawing
  -- review. Same reasoning as this repo reusing forbid_update_delete()/
  -- forbid_delete() instead of writing a new trigger body per table.
  kind finding_kind not null,
  severity finding_severity not null,
  issue text not null,
  action_required text not null,
  -- Citation #1 (the rule): same nullability rule as audit_findings --
  -- null only for missing_document, enforced by the CHECK below. No ON
  -- DELETE override beyond the implicit RESTRICT, same reasoning as
  -- audit_findings' own code_chunk_id: a code chunk that has been cited by
  -- a drawing finding must not silently disappear out from under it.
  code_chunk_id uuid references jurisdiction_code_chunks(id),
  -- Citation #2 (the visual evidence -- NEW vs. audit_findings, this is
  -- Gate 5's actual "evidence-linked" requirement). 1-indexed page within
  -- application_document_id. Same missing_document exemption as
  -- code_chunk_id: an absent-document finding has nothing on any page to
  -- point at.
  source_page int check (source_page is null or source_page >= 1),
  -- Normalized bounding box on that page, e.g. {"x":0.12,"y":0.30,
  -- "width":0.08,"height":0.05} in [0,1] fractions of page width/height --
  -- deliberately NOT required even when source_page is present (a finding
  -- may be page-level, e.g. "no fire separation rating noted anywhere on
  -- this elevation," with no single region to box). No coordinate-range
  -- CHECK beyond "is an object": the exact bounding-box contract (fraction
  -- vs. pixel, origin corner) is a 5.2 service-layer/Zod-schema decision,
  -- not one this migration should freeze into a DB CHECK ahead of that
  -- decision being made.
  source_region jsonb check (source_region is null or jsonb_typeof(source_region) = 'object'),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  review_status finding_review_status not null default 'unverified',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- "No citation, no finding" (SS0.2, 20260806000009), extended to both
  -- citation kinds this table adds.
  check (kind = 'missing_document' or code_chunk_id is not null),
  check (kind = 'missing_document' or source_page is not null),
  check ((review_status = 'unverified') = (reviewed_by is null)),
  check ((review_status = 'unverified') = (reviewed_at is null))
);

create index drawing_findings_drawing_review_id_idx on drawing_findings (drawing_review_id);
create index drawing_findings_code_chunk_id_idx on drawing_findings (code_chunk_id);

alter table drawing_reviews enable row level security;
alter table drawing_findings enable row level security;

create policy drawing_reviews_select on drawing_reviews
  for select to authenticated
  using (
    exists (
      select 1 from permit_applications pa
      where pa.id = drawing_reviews.application_id
        and is_org_member(pa.org_id)
    )
  );

-- Append-only, same trigger every prior lifecycle table already shares --
-- no new trigger body needed.
create trigger drawing_reviews_append_only
  before update or delete on drawing_reviews
  for each row execute function forbid_update_delete();

create policy drawing_findings_select on drawing_findings
  for select to authenticated
  using (
    exists (
      select 1 from drawing_reviews dr
      join permit_applications pa on pa.id = dr.application_id
      where dr.id = drawing_findings.drawing_review_id
        and is_org_member(pa.org_id)
    )
  );

-- Same "review columns only" shape as audit_findings_review_update: a
-- contractor may Confirm/Dismiss a drawing finding, never touch its
-- underlying claim or citations.
create policy drawing_findings_review_update on drawing_findings
  for update to authenticated
  using (
    exists (
      select 1 from drawing_reviews dr
      join permit_applications pa on pa.id = dr.application_id
      where dr.id = drawing_findings.drawing_review_id
        and is_org_member(pa.org_id)
    )
  )
  with check (
    exists (
      select 1 from drawing_reviews dr
      join permit_applications pa on pa.id = dr.application_id
      where dr.id = drawing_findings.drawing_review_id
        and is_org_member(pa.org_id)
    )
  );

create or replace function drawing_findings_restrict_update()
returns trigger
language plpgsql
as $$
begin
  if OLD.drawing_review_id is distinct from NEW.drawing_review_id
     or OLD.kind is distinct from NEW.kind
     or OLD.severity is distinct from NEW.severity
     or OLD.issue is distinct from NEW.issue
     or OLD.action_required is distinct from NEW.action_required
     or OLD.code_chunk_id is distinct from NEW.code_chunk_id
     or OLD.source_page is distinct from NEW.source_page
     or OLD.source_region is distinct from NEW.source_region
     or OLD.confidence is distinct from NEW.confidence
     or OLD.created_at is distinct from NEW.created_at
  then
    raise exception 'drawing_findings is append-only except for review_status/reviewed_by/reviewed_at';
  end if;
  return NEW;
end;
$$;

create trigger drawing_findings_restrict_update_trigger
  before update on drawing_findings
  for each row execute function drawing_findings_restrict_update();

create trigger drawing_findings_no_delete
  before delete on drawing_findings
  for each row execute function forbid_delete();

-- Table-level grants, mirroring extractions/audits/audit_findings exactly
-- (20260806000011, 20260806000015): `authenticated` gets every operation
-- its RLS policies partially allow, so an attempted illegal mutation hits
-- the specific trigger/policy error rather than a generic permission-denied
-- (same reasoning as this repo's other append-only tables' grant comments).
-- service_role gets only what a future 5.2 writer actually needs: SELECT +
-- INSERT on drawing_reviews (mirrors audits' own service_role grant),
-- INSERT only on drawing_findings (mirrors audit_findings' own service_role
-- grant -- INSERT ... RETURNING needs no separate SELECT privilege).
grant select, insert, update, delete on drawing_reviews to authenticated;
grant select, insert, update, delete on drawing_findings to authenticated;
grant select, insert on drawing_reviews to service_role;
grant insert on drawing_findings to service_role;

-- Close the Supabase-platform-default service_role TRUNCATE grant in the
-- same migration that creates these tables (20260806000033's lesson,
-- applied proactively here rather than by a future audit) -- TRUNCATE
-- bypasses every row-level trigger above.
revoke truncate on drawing_reviews from service_role;
revoke truncate on drawing_findings from service_role;

-- New AI-1 task kind for this workstream's job/spend tracking (see header).
-- Per GATE_5_FINDINGS.md §I.1 (Gate AI-1 Q2, resolved): drawing review is
-- architecturally the same shape as extraction/audit (vision + structured
-- tool-use + citation validation against an allowlist), so it stays on
-- Claude directly -- this value is NOT added to lib/ai/router.ts's
-- TASK_ROUTES map, and must not be, the same way 'extraction'/'audit' are
-- explicitly RESERVED_KINDS there rather than routed through the Gemini
-- adapter. Its only purpose is so a future drawing-review Inngest function
-- can write ai_jobs/ai_token_ledger rows with kind = 'drawing_review',
-- provider = 'anthropic' for cost/spend visibility, reusing the ledger
-- rather than bypassing it.
--
-- Not used elsewhere in this same migration file (no DML, no CHECK
-- referencing the literal) -- avoids the well-known Postgres restriction on
-- using a newly added enum value inside the same transaction that added it.
alter type ai_task_kind add value if not exists 'drawing_review';

-- Drawing-category dimension on the jurisdiction code corpus
-- (GATE_5_FINDINGS.md §E.4/§K: "scoped" pre-review needs to narrow by
-- drawing discipline -- structural/electrical/mechanical/zoning/etc. --
-- which no existing column captures). Mirrors permit_type/property_type/
-- language's own precedent exactly (20260806000037): nullable free text, no
-- default, no fixed enum -- null on a chunk means "applies regardless of
-- drawing category" (universal match), not "unknown, exclude it," so
-- adding this column changes zero existing (or future untagged) rows'
-- retrieval behavior. Deliberately free text, not an enum: no product
-- decision on a fixed category list exists yet (GATE_5_FINDINGS.md §J.2),
-- and text keeps that decision from blocking this migration.
--
-- SCHEMA ONLY: unlike 20260806000037 (which shipped its three new dimension
-- columns and search_jurisdiction_code_chunks's matching filter params in
-- one migration), this column's retrieval-side wiring (a new
-- p_drawing_category filter arg, requiring the same DROP + CREATE FUNCTION
-- 20260806000037 needed to change the RETURNS TABLE shape) is deliberately
-- deferred to Gate 5.2, when a real caller exists -- same "declare now,
-- wire at the first real call site" discipline as jurisdiction_sources
-- (20260806000021) and application_document_chunks' own ingestion pipeline.
-- No index added here either, for the same reason: the corpus is still
-- empty (GATE_5_FINDINGS.md §E.5), and the composite index shape should be
-- chosen alongside the RPC filter that will actually use it, not guessed at
-- ahead of that.
alter table jurisdiction_code_chunks add column drawing_category text;
