import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isAiRoutingEnabled, isAiTokenCapsEnabled } from '@/lib/flags';
import { computeTextDensity } from '@/lib/pdf/text-density';
import { classifyDocument } from '@/lib/ai/classify-document';
import { estimateCostUsdCents } from '@/lib/ai/estimate-cost';
import { checkOrgMonthlyCostCap } from '@/lib/ai/cost-caps';
import { UPLOADS_BUCKET, isAllowedMimeType } from '@/lib/storage/documents';
import { AiJobInsertSchema, AiTokenLedgerInsertSchema } from '@/lib/ai/schemas/ai-task';

// Gate AI-1, sub-phase AI-1.3 (GATE_AI_1_FINDINGS.md §D/§G). First real
// caller of lib/ai/router.ts's routeAiTask() (indirectly, via
// lib/ai/classify-document.ts). Triggered by the same
// 'permit/application.documents_ready' event permit.extract already
// subscribes to (app/api/documents/route.ts, once the upload set is
// complete) -- same "multiple independent subscribers to one event" shape
// as permit-notify/permit-notify-on-failure's own two-listener pattern for
// 'permit/application.extracted', just applied to a different event.
//
// isAiRoutingEnabled() gates the entire function: when off (the default),
// this returns immediately with no DB reads and no ai_jobs rows, mirroring
// every other "declared ahead of its consumer" flag in this workstream --
// flipping the flag on is the only change needed to activate a function
// that is otherwise already complete, tested, callable code.
//
// Scoped deliberately to text-routed PDF documents only:
// lib/ai/gemini/client.ts's generateContent has no vision/file-input support
// (that file's own header) -- a vision-routed PDF or a non-PDF (scanned
// image) upload is an honest, documented gap here (silently skipped, no
// ai_jobs row, no suggestion written), not a job that pretends to have
// classified something it never actually read. Also skips documents that
// already carry a suggestion (ai_suggested_doc_kind is not null) -- a
// classification job re-running (e.g. a second, later upload batch for the
// same application, once this function's own idempotency window has
// passed) should not re-spend model calls re-classifying documents it
// already has an answer for.
//
// idempotency is keyed on applicationId, matching permit.extract's own key
// for the same event -- this run processes every eligible document for one
// application in one go, same granularity as extract.ts's own per-
// application loop.
//
// Gate AI-1, sub-phase AI-1.4 (GATE_AI_1_FINDINGS.md §G/§H RUNAWAY_SPEND):
// first real caller of lib/ai/cost-caps.ts's checkOrgMonthlyCostCap(),
// gated independently behind isAiTokenCapsEnabled(). Checked fresh
// immediately before each classify-call-model-* step (not once for the
// whole batch) so a batch that starts under the org's monthly cap but
// crosses it partway through -- exactly the "one org submits a 900-page
// bylaw package 500 times" scenario that findings file names, just at
// per-document rather than per-application granularity -- stops attempting
// further model calls for the remaining documents in this same run, not
// only on some future invocation. A capped document is recorded as skipped,
// same as a document this function silently skips for any other reason
// (vision-routed, non-PDF, already classified) -- no ai_jobs row, because no
// model call was ever attempted.
export const permitClassifyDocuments = inngest.createFunction(
  {
    id: 'permit-classify-documents',
    name: 'Classify uploaded application documents',
    triggers: [{ event: 'permit/application.documents_ready' }],
    idempotency: 'event.data.applicationId',
    retries: 2,
  },
  async ({ event, step }) => {
    const { applicationId } = event.data as PermitEventPayloads['permit/application.documents_ready'];

    if (!isAiRoutingEnabled()) {
      return { applicationId, classified: 0, skipped: 0 };
    }

    const supabase = createServiceClient();

    const { orgId, documents } = await step.run('load-application-and-documents', async () => {
      const { data: application, error: appError } = await supabase
        .from('permit_applications')
        .select('id, org_id')
        .eq('id', applicationId)
        .single();
      if (appError || !application) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
      }

      const { data: documents, error: docsError } = await supabase
        .from('application_documents')
        .select('id, storage_path, original_filename, mime_type, ai_suggested_doc_kind')
        .eq('application_id', applicationId);
      if (docsError) {
        throw new Error(`Failed to load application_documents for ${applicationId}: ${docsError.message}`);
      }

      return { orgId: application.org_id as string, documents: documents ?? [] };
    });

    let classifiedCount = 0;
    let skippedCount = 0;

    for (const doc of documents) {
      // Already has a suggestion from an earlier run -- see this file's
      // header for why that's a skip, not a re-classify.
      if (doc.ai_suggested_doc_kind !== null) {
        skippedCount++;
        continue;
      }

      const prepared = await step.run(`classify-prepare-${doc.id}`, async () => {
        if (!isAllowedMimeType(doc.mime_type)) {
          throw new Error(`Document ${doc.id} has disallowed mime_type ${doc.mime_type}; upload validation should have rejected this.`);
        }

        // Only PDFs can even be routed 'text' by computeTextDensity -- a
        // non-PDF upload (scanned image) has no text layer to extract, so
        // there is nothing eligible to classify here at all.
        if (doc.mime_type !== 'application/pdf') {
          return null;
        }

        const { data: fileData, error: downloadError } = await supabase.storage
          .from(UPLOADS_BUCKET)
          .download(doc.storage_path);
        if (downloadError || !fileData) {
          throw new Error(`Failed to download ${doc.storage_path}: ${downloadError?.message ?? 'no data'}`);
        }
        const bytes = Buffer.from(await fileData.arrayBuffer());

        const density = await computeTextDensity(bytes);
        if (density.route !== 'text' || !density.extractedText || density.extractedText.trim().length === 0) {
          return null;
        }

        return { filename: doc.original_filename as string, textContent: density.extractedText };
      });

      if (!prepared) {
        skippedCount++;
        continue;
      }

      // Gate AI-1, sub-phase AI-1.4 pre-flight cost-cap check -- see this
      // file's header comment for why this runs fresh per-document,
      // immediately before the model call it's gating, rather than once for
      // the whole batch.
      if (isAiTokenCapsEnabled()) {
        const capCheck = await step.run(`classify-cost-cap-check-${doc.id}`, async () => checkOrgMonthlyCostCap(supabase, orgId));
        if (!capCheck.withinCap) {
          skippedCount++;
          continue;
        }
      }

      const classification = await step.run(`classify-call-model-${doc.id}`, async () => classifyDocument(prepared));

      // Fail closed (global engineering rule, mirrors permit.audit/
      // permit.drawing_review's own structurallyValid branch): a failed
      // classification attempt is recorded in the ai_jobs ledger so a bad
      // prompt revision is visible in spend/job data, but
      // application_documents.ai_suggested_doc_kind is left untouched.
      const jobInsert = classification.structurallyValid
        ? AiJobInsertSchema.parse({
            org_id: orgId,
            kind: 'classification',
            provider: 'gemini',
            model_id: classification.modelId,
            status: 'succeeded',
            input_token_count: classification.inputTokens,
            output_token_count: classification.outputTokens,
            error_message: null,
            related_entity_type: 'application_document',
            related_entity_id: doc.id,
            requested_by_user_id: null,
          })
        : AiJobInsertSchema.parse({
            org_id: orgId,
            kind: 'classification',
            provider: 'gemini',
            model_id: classification.modelId,
            status: 'failed',
            input_token_count: classification.inputTokens,
            output_token_count: classification.outputTokens,
            error_message: 'Model response failed structural validation after all retry attempts.',
            related_entity_type: 'application_document',
            related_entity_id: doc.id,
            requested_by_user_id: null,
          });

      // Same "split into separate steps" discipline as
      // drawing-review.ts's own header comment: the ai_jobs insert, the
      // ai_token_ledger insert, and the application_documents update are
      // three separate step.run() calls (not one), so a retry after any one
      // of them fails replays the already-succeeded steps from their
      // memoized result instead of re-executing the whole chain and
      // double-inserting the ai_jobs row (no unique constraint on that
      // table would reject a duplicate).
      const insertedJob = await step.run(`classify-insert-ai-job-${doc.id}`, async () => {
        const { data: inserted, error: jobError } = await supabase
          .from('ai_jobs')
          .insert(jobInsert)
          .select('id')
          .single();
        if (jobError || !inserted) {
          throw new Error(`Failed to insert ai_jobs row for document ${doc.id}: ${jobError?.message ?? 'no row returned'}`);
        }
        return { jobId: inserted.id as string };
      });

      if (!classification.structurallyValid || !classification.parsed) {
        skippedCount++;
        continue;
      }

      const jobId = insertedJob.jobId;

      await step.run(`classify-insert-ledger-${doc.id}`, async () => {
        const ledgerInsert = AiTokenLedgerInsertSchema.parse({
          org_id: orgId,
          job_id: jobId,
          provider: 'gemini',
          model_id: classification.modelId,
          input_token_count: classification.inputTokens,
          output_token_count: classification.outputTokens,
          cost_usd_cents: estimateCostUsdCents(classification.inputTokens, classification.outputTokens),
        });
        const { error: ledgerError } = await supabase.from('ai_token_ledger').insert(ledgerInsert);
        if (ledgerError) {
          throw new Error(`Failed to insert ai_token_ledger row for document ${doc.id}: ${ledgerError.message}`);
        }
      });

      await step.run(`classify-update-document-${doc.id}`, async () => {
        const { error: updateError } = await supabase
          .from('application_documents')
          .update({
            ai_suggested_doc_kind: classification.parsed!.doc_kind,
            ai_suggested_doc_kind_confidence: classification.parsed!.confidence,
            ai_classification_job_id: jobId,
          })
          .eq('id', doc.id);
        if (updateError) {
          throw new Error(`Failed to update application_documents row ${doc.id}: ${updateError.message}`);
        }
      });

      classifiedCount++;
    }

    return { applicationId, classified: classifiedCount, skipped: skippedCount };
  }
);
