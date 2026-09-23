-- Gate AI-1, sub-phase AI-1.3 ("Jobs (flag-gated)", GATE_AI_1_FINDINGS.md
-- §D/§G). Additive-only, per this repo's standing migration convention: no
-- existing table, column, or enum value is altered or removed.
--
-- Per §D's own finding, `doc_kind` is user-supplied at upload time
-- (app/api/documents/route.ts) and there is no automated classification
-- step today -- AI-1.3's classification job is "genuinely new capability,
-- not a replacement of an existing classifier". Per §G's AI-1.3 blast-radius
-- note ("new doc_kind-setting logic that coexists with the user-supplied
-- value at upload"), this migration therefore adds a SEPARATE suggestion
-- column rather than overwriting doc_kind itself -- the user-supplied value
-- remains the one every existing query/RLS-untouched code path already
-- reads; a classification job disagreeing with the uploader is a fact for a
-- human to reconcile, never a silent overwrite of what they chose.
--
-- ai_suggested_doc_kind reuses the existing doc_kind enum rather than
-- inventing a near-duplicate (same reasoning 20260806000045's header gives
-- for drawing_findings reusing audit_findings' own finding_kind/severity
-- enums): a classifier's guess and a human's choice are answers to the same
-- question, so they share the same vocabulary.
alter table application_documents
  add column ai_suggested_doc_kind doc_kind,
  add column ai_suggested_doc_kind_confidence numeric,
  -- Back-reference to the ai_jobs row that produced the suggestion, mirrors
  -- drawing_reviews.ai_job_id (20260806000045) reusing the same AI-1.1
  -- ledger rather than duplicating model_id/token-count columns a third
  -- time. ON DELETE SET NULL, not CASCADE: an ai_jobs row disappearing (only
  -- ever via its owning org's own cascade delete, per that table's own
  -- header) must not take the application_documents row itself down with
  -- it -- the document, and the user-supplied doc_kind on it, remain
  -- meaningful with or without a surviving classification job to point at.
  add column ai_classification_job_id uuid references ai_jobs(id) on delete set null;

-- Same pairing discipline as drawing_findings' own
-- "(review_status = 'unverified') = (reviewed_by is null)" CHECK
-- (20260806000045): a suggestion and its confidence appear together or not
-- at all, so a caller can never end up with one half of a suggestion.
alter table application_documents
  add constraint application_documents_ai_suggestion_pairing
  check ((ai_suggested_doc_kind is null) = (ai_suggested_doc_kind_confidence is null));

alter table application_documents
  add constraint application_documents_ai_suggestion_confidence_range
  check (ai_suggested_doc_kind_confidence is null or (ai_suggested_doc_kind_confidence >= 0 and ai_suggested_doc_kind_confidence <= 1));

create index application_documents_ai_classification_job_id_idx
  on application_documents (ai_classification_job_id);

-- No RLS/grant change: application_documents' existing policies and its
-- existing `grant select, update on application_documents to service_role`
-- (20260806000015_service_role_grants.sql:31) already cover a service-role
-- writer updating these three new columns on an existing row -- the
-- classification job (lib/inngest/functions/classify-documents.ts) needs no
-- new privilege beyond what extract.ts's own text_layer_chars UPDATE already
-- relies on.
