import Anthropic from '@anthropic-ai/sdk';
import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isDrawingReviewEnabled } from '@/lib/flags';
import { computeTextDensity } from '@/lib/pdf/text-density';
import { reviewDrawing } from '@/lib/ai/review-drawing';
import type { ExtractionDocumentInput } from '@/lib/ai/extract-permit-data';
import { buildDrawingReviewQueryText, retrieveCodeChunks } from '@/lib/ai/retrieve-code-chunks';
import { estimateCostUsdCents } from '@/lib/ai/estimate-cost';
import { UPLOADS_BUCKET, isAllowedMimeType } from '@/lib/storage/documents';
import { AiJobInsertSchema, AiTokenLedgerInsertSchema } from '@/lib/ai/schemas/ai-task';

// Gate 5, sub-phase 5.2 (GATE_5_FINDINGS.md §K). permit.drawing_review:
// reviews a single uploaded drawing/blueprint document against retrieved
// jurisdiction code excerpts, producing citable drawing_findings. Triggered
// by 'permit/application.drawing_review_ready' -- unlike permit.extract/
// permit.audit, this event has no real emitter yet anywhere in this
// codebase (no classifier exists to decide "this uploaded document is a
// drawing, go review it" -- see lib/ai/config.ts's own
// DRAWING_REVIEW_MAX_RETRIEVED_CHUNKS comment and 20260806000045's header on
// drawing_category being schema-only). Same "declared ahead of its
// consumer" discipline as every flag/column/enum value in this workstream:
// this function is real, callable, end-to-end-testable code with zero
// production trigger sites, not a stub.
//
// idempotency is keyed on applicationDocumentId, not applicationId --
// mirroring permit.audit's own reasoning for keying on extractionId rather
// than applicationId: an application can have more than one drawing
// document, and each one's review is independently retryable/idempotent
// without colliding with a sibling document's review of the same
// application.
//
// Deliberately does NOT read or write permit_applications.status anywhere
// in this function -- unlike permit.extract/permit.audit, which drive the
// application through extracting/auditing/ready_for_review. Gate 5.2 is
// scoped to producing a reviewable drawing_reviews/drawing_findings result
// only; folding a per-document review into the whole-application status
// machine (e.g. "all drawings reviewed" -> some new status) is a product
// decision deferred to Gate 5.4, not assumed here.
export const permitDrawingReview = inngest.createFunction(
  {
    id: 'permit-drawing-review',
    name: 'Review a drawing document against jurisdiction code',
    triggers: [{ event: 'permit/application.drawing_review_ready' }],
    idempotency: 'event.data.applicationDocumentId',
    retries: 2,
  },
  async ({ event, step }) => {
    const { applicationId, applicationDocumentId } =
      event.data as PermitEventPayloads['permit/application.drawing_review_ready'];
    const supabase = createServiceClient();

    const context = await step.run('load-context', async () => {
      const { data: document, error: documentError } = await supabase
        .from('application_documents')
        .select('id, storage_path, original_filename, mime_type, application_id')
        .eq('id', applicationDocumentId)
        .single();
      if (documentError || !document) {
        throw new Error(
          `application_documents row not found for ${applicationDocumentId}: ${documentError?.message ?? 'no row'}`
        );
      }
      if (document.application_id !== applicationId) {
        throw new Error(
          `application_documents row ${applicationDocumentId} belongs to application ${document.application_id}, not the event's ${applicationId}.`
        );
      }

      const { data: application, error: appError } = await supabase
        .from('permit_applications')
        .select('id, org_id, permit_type_id')
        .eq('id', applicationId)
        .single();
      if (appError || !application) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
      }

      const { data: permitType, error: permitTypeError } = await supabase
        .from('permit_types')
        .select('title, jurisdiction_id')
        .eq('id', application.permit_type_id)
        .single();
      if (permitTypeError || !permitType) {
        throw new Error(
          `permit_types row not found for ${application.permit_type_id}: ${permitTypeError?.message ?? 'no row'}`
        );
      }

      const { data: jurisdiction, error: jurisdictionError } = await supabase
        .from('jurisdictions')
        .select('id, coverage_level')
        .eq('id', permitType.jurisdiction_id)
        .single();
      if (jurisdictionError || !jurisdiction) {
        throw new Error(
          `jurisdictions row not found for ${permitType.jurisdiction_id}: ${jurisdictionError?.message ?? 'no row'}`
        );
      }

      return {
        orgId: application.org_id as string,
        document: {
          id: document.id as string,
          storagePath: document.storage_path as string,
          originalFilename: document.original_filename as string,
          mimeType: document.mime_type as string,
        },
        permitTypeTitle: permitType.title as string,
        jurisdictionId: jurisdiction.id as string,
        coverageLevel: jurisdiction.coverage_level as string,
      };
    });

    // Two independent gates, same reasoning as permit.audit's own comment on
    // isAiAuditEnabled() + coverage_level: an ops-level kill switch and a
    // per-jurisdiction product-tier gate must BOTH independently allow the
    // model to run. When gated off, no drawing_reviews row is inserted --
    // "no row exists yet" is the honest, UI-distinguishable signal for "not
    // yet covered", never a zero-findings row that would look identical to
    // a genuinely clean 'verified'-jurisdiction review.
    if (!isDrawingReviewEnabled() || context.coverageLevel !== 'verified') {
      await step.sendEvent('emit-drawing-reviewed-skipped-not-covered', {
        // Deterministic id -- see extract.ts's emit-extracted-event for the
        // full "why" (closes permit-notify's residual duplicate-delivery
        // gap via Inngest's id-based event-ingestion dedup). Keyed on
        // applicationDocumentId, matching this file's own
        // idempotency: 'event.data.applicationDocumentId' -- each
        // application_documents row is itself a fresh, never-reused
        // identity per this file's own header comment (one row per real
        // uploaded drawing), so unlike generate-pdf.ts's applicationId this
        // isn't a "deliberately collapse a legitimate second occurrence"
        // tradeoff, it's simply the correct per-occurrence key.
        id: `permit/application.drawing_reviewed:${applicationDocumentId}`,
        name: 'permit/application.drawing_reviewed',
        data: {
          applicationId,
          applicationDocumentId,
          drawingReviewId: null,
          reviewed: false,
        } satisfies PermitEventPayloads['permit/application.drawing_reviewed'],
      });
      return { applicationId, applicationDocumentId, drawingReviewId: null, reviewed: false };
    }

    // Single-document prep, same download/route-by-text-density logic as
    // permit.extract's own per-document loop (lib/pdf/text-density.ts),
    // reused verbatim rather than reinvented for this one-document case.
    const preparedDocument = await step.run('prepare-document', async () => {
      const doc = context.document;
      if (!isAllowedMimeType(doc.mimeType)) {
        throw new Error(
          `Document ${doc.id} has disallowed mime_type ${doc.mimeType}; upload validation should have rejected this.`
        );
      }

      const { data: fileData, error: downloadError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .download(doc.storagePath);
      if (downloadError || !fileData) {
        throw new Error(`Failed to download ${doc.storagePath}: ${downloadError?.message ?? 'no data'}`);
      }
      const bytes = Buffer.from(await fileData.arrayBuffer());

      if (doc.mimeType !== 'application/pdf') {
        return {
          id: doc.id,
          filename: doc.originalFilename,
          route: 'vision' as const,
          bytesBase64: bytes.toString('base64'),
        } satisfies ExtractionDocumentInput;
      }

      const density = await computeTextDensity(bytes);
      await supabase
        .from('application_documents')
        .update({ text_layer_chars: density.charCount })
        .eq('id', doc.id);

      if (density.route === 'text') {
        return {
          id: doc.id,
          filename: doc.originalFilename,
          route: 'text' as const,
          textContent: density.extractedText ?? undefined,
        } satisfies ExtractionDocumentInput;
      }

      return {
        id: doc.id,
        filename: doc.originalFilename,
        route: 'vision' as const,
        bytesBase64: bytes.toString('base64'),
      } satisfies ExtractionDocumentInput;
    });

    // p_drawing_category is omitted (undefined) here -- no real classifier
    // exists yet to populate it (same "declare ahead of its consumer"
    // discipline as the column itself); every retrieved chunk is matched on
    // permit type/jurisdiction only, same as this function's non-drawing
    // siblings.
    const retrievedChunks = await step.run('retrieve-code-chunks', async () => {
      const queryText = buildDrawingReviewQueryText({
        permitTypeTitle: context.permitTypeTitle,
        documentFilename: preparedDocument.filename,
      });
      return retrieveCodeChunks(supabase, context.jurisdictionId, queryText);
    });

    const modelResult = await step.run('call-model-and-validate', async () => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      return reviewDrawing(client, preparedDocument, retrievedChunks);
    });

    // Fail closed (global engineering rule, mirrors permit.audit's own
    // structurallyValid branch): every model attempt failed structural
    // validation, so no drawing_reviews row is inserted at all. The failure
    // itself is still recorded, in the ai_jobs ledger this is the FIRST real
    // writer of, so a bad prompt revision / persistent failure is visible in
    // spend/job data even though no drawing_reviews row exists to point at
    // it.
    if (!modelResult.structurallyValid) {
      await step.run('insert-failed-ai-job', async () => {
        const jobInsert = AiJobInsertSchema.parse({
          org_id: context.orgId,
          kind: 'drawing_review',
          provider: 'anthropic',
          model_id: modelResult.modelId,
          status: 'failed',
          input_token_count: modelResult.inputTokens,
          output_token_count: modelResult.outputTokens,
          error_message: 'Model response failed structural validation after all retry attempts.',
          related_entity_type: 'application_document',
          related_entity_id: applicationDocumentId,
          requested_by_user_id: null,
        });
        const { error: jobError } = await supabase.from('ai_jobs').insert(jobInsert);
        if (jobError) {
          throw new Error(`Failed to insert failed ai_jobs row: ${jobError.message}`);
        }
      });

      await step.sendEvent('emit-drawing-reviewed-failed', {
        // Deterministic id -- see emit-drawing-reviewed-skipped-not-covered
        // above for the full "why".
        id: `permit/application.drawing_reviewed:${applicationDocumentId}`,
        name: 'permit/application.drawing_reviewed',
        data: {
          applicationId,
          applicationDocumentId,
          drawingReviewId: null,
          reviewed: false,
        } satisfies PermitEventPayloads['permit/application.drawing_reviewed'],
      });
      return { applicationId, applicationDocumentId, drawingReviewId: null, reviewed: false };
    }

    // Same corpus_version sentinel convention as permit.audit's own
    // comment: 'no-corpus-ingested' is the honest, real state of this
    // codebase pre-ingestion, not a fabricated-looking value forced into a
    // NOT NULL column.
    const corpusVersion =
      retrievedChunks.length > 0
        ? [...new Set(retrievedChunks.map((c) => c.corpusVersion))].sort().join('+')
        : 'no-corpus-ingested';

    // Health-check audit finding, applied proactively here (mirrors
    // permit.audit's own header comment on why its insert steps are split):
    // ai_jobs -> ai_token_ledger -> drawing_reviews -> drawing_findings ->
    // drawing_findings_rejected are FIVE separate step.run() calls, not one.
    // None of these five tables has a unique constraint that would reject a
    // duplicate row, so a retry after any downstream failure must replay
    // already-succeeded steps from their memoized result rather than
    // re-executing the whole chain and double-inserting whichever step(s)
    // already succeeded.
    const insertedJob = await step.run('insert-succeeded-ai-job', async () => {
      const jobInsert = AiJobInsertSchema.parse({
        org_id: context.orgId,
        kind: 'drawing_review',
        provider: 'anthropic',
        model_id: modelResult.modelId,
        status: 'succeeded',
        input_token_count: modelResult.inputTokens,
        output_token_count: modelResult.outputTokens,
        error_message: null,
        related_entity_type: 'application_document',
        related_entity_id: applicationDocumentId,
        requested_by_user_id: null,
      });
      const { data: inserted, error: jobError } = await supabase
        .from('ai_jobs')
        .insert(jobInsert)
        .select('id')
        .single();
      if (jobError || !inserted) {
        throw new Error(`Failed to insert succeeded ai_jobs row: ${jobError?.message ?? 'no row returned'}`);
      }
      return { jobId: inserted.id as string };
    });
    const jobId = insertedJob.jobId;

    await step.run('insert-token-ledger-row', async () => {
      const ledgerInsert = AiTokenLedgerInsertSchema.parse({
        org_id: context.orgId,
        job_id: jobId,
        provider: 'anthropic',
        model_id: modelResult.modelId,
        input_token_count: modelResult.inputTokens,
        output_token_count: modelResult.outputTokens,
        cost_usd_cents: estimateCostUsdCents(modelResult.inputTokens, modelResult.outputTokens),
      });
      const { error: ledgerError } = await supabase.from('ai_token_ledger').insert(ledgerInsert);
      if (ledgerError) {
        throw new Error(`Failed to insert ai_token_ledger row: ${ledgerError.message}`);
      }
    });

    const insertedReview = await step.run('insert-drawing-review-row', async () => {
      const { data: inserted, error: reviewError } = await supabase
        .from('drawing_reviews')
        .insert({
          application_id: applicationId,
          application_document_id: applicationDocumentId,
          ai_job_id: jobId,
          corpus_version: corpusVersion,
        })
        .select('id')
        .single();
      if (reviewError || !inserted) {
        throw new Error(`Failed to insert drawing_reviews row: ${reviewError?.message ?? 'no row returned'}`);
      }
      return { drawingReviewId: inserted.id as string };
    });
    const drawingReviewId = insertedReview.drawingReviewId;

    await step.run('insert-drawing-findings', async () => {
      if (modelResult.findings.length === 0) return;
      const { error: findingsError } = await supabase.from('drawing_findings').insert(
        modelResult.findings.map((f) => ({
          drawing_review_id: drawingReviewId,
          kind: f.kind,
          severity: f.severity,
          issue: f.issue,
          action_required: f.action_required,
          code_chunk_id: f.code_chunk_id,
          source_page: f.source_page,
          source_region: f.source_region,
          confidence: f.confidence,
        }))
      );
      if (findingsError) {
        throw new Error(`Failed to insert drawing_findings rows: ${findingsError.message}`);
      }
    });

    // SS6 citation-validity-rate metric, mirrored for this pipeline (see
    // 20260806000046_drawing_findings_rejected.sql) -- rejections are
    // persisted, never silently dropped.
    await step.run('insert-rejected-findings', async () => {
      if (modelResult.rejected.length === 0) return;
      const { error: rejectedError } = await supabase.from('drawing_findings_rejected').insert(
        modelResult.rejected.map((r) => ({
          drawing_review_id: drawingReviewId,
          application_document_id: applicationDocumentId,
          raw_finding: r.rawFinding as object,
          rejection_reason: r.reason,
          model_id: modelResult.modelId,
          prompt_version: modelResult.promptVersion,
        }))
      );
      if (rejectedError) {
        throw new Error(`Failed to insert drawing_findings_rejected rows: ${rejectedError.message}`);
      }
    });

    await step.sendEvent('emit-drawing-reviewed-event', {
      // Deterministic id -- see emit-drawing-reviewed-skipped-not-covered
      // above for the full "why".
      id: `permit/application.drawing_reviewed:${applicationDocumentId}`,
      name: 'permit/application.drawing_reviewed',
      data: {
        applicationId,
        applicationDocumentId,
        drawingReviewId,
        reviewed: true,
      } satisfies PermitEventPayloads['permit/application.drawing_reviewed'],
    });

    return { applicationId, applicationDocumentId, drawingReviewId, reviewed: true };
  }
);
