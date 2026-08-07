import Anthropic from '@anthropic-ai/sdk';
import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { computeTextDensity } from '@/lib/pdf/text-density';
import { extractPermitData, type ExtractionDocumentInput } from '@/lib/ai/extract-permit-data';
import { parseCurrencyToCents, centsToSafeNumber } from '@/lib/money/cents';
import { UPLOADS_BUCKET, isAllowedMimeType } from '@/lib/storage/documents';

// permit.extract: turns an application's uploaded documents into a validated
// extraction row. Triggered by 'permit/application.documents_ready'
// (app/api/documents/route.ts, once the upload set is complete).
//
// SS7 adversarial check #8 ("the retry storm"): `idempotency` is keyed on
// applicationId so Inngest collapses concurrent/retried runs for the same
// application into a single execution instead of racing to insert multiple
// append-only `extractions` rows. `retries` covers genuine transient
// failures (network, Anthropic 5xx) -- validation failures are NOT retried
// at the Inngest level, they're handled inside extractPermitData's own
// bounded retry loop and then persisted as a terminal zod_valid=false row.
export const permitExtract = inngest.createFunction(
  {
    id: 'permit-extract',
    name: 'Extract permit application data',
    triggers: [{ event: 'permit/application.documents_ready' }],
    idempotency: 'event.data.applicationId',
    retries: 2,
  },
  async ({ event, step }) => {
    const { applicationId } = event.data as PermitEventPayloads['permit/application.documents_ready'];
    const supabase = createServiceClient();

    // The application row itself isn't needed past this existence check --
    // only its documents feed the rest of the run -- so only `documents` is
    // kept from this step's return value.
    const { documents } = await step.run('load-application-and-documents', async () => {
      const { data: application, error: appError } = await supabase
        .from('permit_applications')
        .select('id, currency_code')
        .eq('id', applicationId)
        .single();

      if (appError || !application) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
      }

      const { data: documents, error: docsError } = await supabase
        .from('application_documents')
        .select('id, storage_path, original_filename, mime_type')
        .eq('application_id', applicationId);

      if (docsError) {
        throw new Error(`Failed to load application_documents for ${applicationId}: ${docsError.message}`);
      }
      if (!documents || documents.length === 0) {
        throw new Error(`No application_documents rows found for ${applicationId}; nothing to extract.`);
      }

      return { application, documents };
    });

    await step.run('mark-extracting', async () => {
      const { error } = await supabase
        .from('permit_applications')
        .update({ status: 'extracting' })
        .eq('id', applicationId);
      if (error) throw new Error(`Failed to set status=extracting: ${error.message}`);
    });

    // Per-document prep: download from Storage, route by MIME type / text
    // density (SS7 adversarial check #2 -- scanned blueprints with no text
    // layer must go to vision, not be silently truncated to empty text),
    // and persist text_layer_chars for later debugging/auditing of the
    // routing decision.
    const preparedDocuments: ExtractionDocumentInput[] = [];
    for (const doc of documents) {
      const prepared = await step.run(`prepare-document-${doc.id}`, async () => {
        if (!isAllowedMimeType(doc.mime_type)) {
          throw new Error(`Document ${doc.id} has disallowed mime_type ${doc.mime_type}; upload validation should have rejected this.`);
        }

        const { data: fileData, error: downloadError } = await supabase.storage
          .from(UPLOADS_BUCKET)
          .download(doc.storage_path);
        if (downloadError || !fileData) {
          throw new Error(`Failed to download ${doc.storage_path}: ${downloadError?.message ?? 'no data'}`);
        }
        const bytes = Buffer.from(await fileData.arrayBuffer());

        // Non-PDF (scanned images) go straight to vision -- there is no text
        // layer to even attempt to extract.
        if (doc.mime_type !== 'application/pdf') {
          return {
            id: doc.id,
            filename: doc.original_filename,
            route: 'vision' as const,
            bytesBase64: bytes.toString('base64'),
          };
        }

        const density = await computeTextDensity(bytes);
        await supabase
          .from('application_documents')
          .update({ text_layer_chars: density.charCount })
          .eq('id', doc.id);

        if (density.route === 'text') {
          return {
            id: doc.id,
            filename: doc.original_filename,
            route: 'text' as const,
            textContent: density.extractedText ?? undefined,
          };
        }

        return {
          id: doc.id,
          filename: doc.original_filename,
          route: 'vision' as const,
          bytesBase64: bytes.toString('base64'),
        };
      });

      preparedDocuments.push(prepared);
    }

    const extraction = await step.run('call-model-and-validate', async () => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      return extractPermitData(client, preparedDocuments);
    });

    const persisted = await step.run('persist-extraction', async () => {
      // Deterministic, model-free currency conversion (SS7 adversarial check
      // #7): the model only ever supplies the raw printed string via
      // estimated_job_value_raw; parseCurrencyToCents does the arithmetic
      // here, outside the model's control, or returns null if unparseable --
      // never a silently wrong guess.
      let parsedWithCents: Record<string, unknown> | null = null;
      if (extraction.zodValid && extraction.parsed) {
        const rawValue = extraction.parsed.estimated_job_value_raw.value;
        const cents = rawValue !== null ? parseCurrencyToCents(rawValue) : null;
        // centsToSafeNumber is the guarded bigint -> number crossing (throws
        // on an out-of-range/negative value rather than silently truncating);
        // a corrupt/adversarial printed amount degrades to null here instead
        // of failing the whole extraction.
        let centsNumber: number | null = null;
        if (cents !== null) {
          try {
            centsNumber = centsToSafeNumber(cents);
          } catch {
            centsNumber = null;
          }
        }
        parsedWithCents = {
          ...extraction.parsed,
          estimated_job_value_cents: centsNumber,
        };
      }

      const { data: inserted, error: insertError } = await supabase
        .from('extractions')
        .insert({
          application_id: applicationId,
          model_id: extraction.modelId,
          prompt_version: extraction.promptVersion,
          input_token_count: extraction.inputTokens,
          output_token_count: extraction.outputTokens,
          raw_response: extraction.rawResponse as object,
          parsed_data: parsedWithCents,
          zod_valid: extraction.zodValid,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        throw new Error(`Failed to insert extractions row: ${insertError?.message ?? 'no row returned'}`);
      }

      // Fail closed (global engineering rule + SS7 check #6): a validation
      // failure never leaves the application looking like extraction is
      // still pending -- it's routed to extraction_failed so a human/retry
      // path is triggered, and never silently treated as "extracted".
      const nextStatus = extraction.zodValid ? 'extracted' : 'extraction_failed';
      const { error: statusError } = await supabase
        .from('permit_applications')
        .update({ status: nextStatus })
        .eq('id', applicationId);
      if (statusError) {
        throw new Error(`Failed to set status=${nextStatus}: ${statusError.message}`);
      }

      return { extractionId: inserted.id as string };
    });

    await step.sendEvent('emit-extracted-event', {
      name: 'permit/application.extracted',
      data: {
        applicationId,
        extractionId: persisted.extractionId,
        zodValid: extraction.zodValid,
      } satisfies PermitEventPayloads['permit/application.extracted'],
    });

    return {
      applicationId,
      extractionId: persisted.extractionId,
      zodValid: extraction.zodValid,
    };
  }
);
