-- Additive-only (global engineering rule): Phase 4 needs a pipeline state
-- for "PDF generation in progress" and its two counterparts (success,
-- failure), mirroring the extracting/extracted/extraction_failed and
-- auditing/ready_for_review/audit_failed triads already in this enum.
-- Without these, permit.generate_pdf (lib/inngest/functions/generate-pdf.ts)
-- would have to leave an application sitting in whatever status it was
-- already in ('reviewed' or 'extracted') while generation runs and after it
-- fails, which misrepresents the application's real state exactly the way
-- 20260806000012's header describes for extraction.
--
-- 'documents_generated' is the success terminal state. It is deliberately
-- NOT 'submitted' -- 'submitted' means the contractor has actually filed the
-- generated PDF with the authority (a Phase 5/UI-driven transition, not
-- something this pipeline can claim on their behalf); conflating "we
-- produced a PDF" with "this was submitted to the authority" would be a
-- false claim this system must not make.
--
-- Three ADD VALUE statements in one file, none referenced/used by any DML in
-- this same file, is safe per 20260806000012's own header comment: the
-- Postgres restriction is on USING a newly-added value within the same
-- transaction that added it (e.g. in an INSERT/UPDATE/comparison), not on
-- how many bare ADD VALUE statements a single transaction may contain.
alter type application_status add value 'generating_documents' after 'reviewed';
alter type application_status add value 'document_generation_failed' after 'generating_documents';
alter type application_status add value 'documents_generated' after 'document_generation_failed';
