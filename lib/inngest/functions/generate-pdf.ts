import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { fillAcroForm, type AcroFormFillInstruction } from '@/lib/pdf/fill-acroform';
import { fillOverlay, type OverlayFillInstruction } from '@/lib/pdf/overlay-coordinates';
import { buildFieldResolutionContext, resolveFieldForFilling } from '@/lib/pdf/resolve-fields';
import { buildStoragePath, computeSha256, FORM_TEMPLATES_BUCKET, GENERATED_BUCKET } from '@/lib/storage/documents';

// permit.generate_pdf: fills each of an application's permit_type_filings'
// PDF templates with the application's resolved field data and persists a
// generated_documents row per filing (Phase 4, README).
//
// Two triggers, one eligibility gate: 'assisted'-tier applications never go
// through human review (audit.ts skips the audit entirely for them, but
// still emits 'permit/application.audited' with audited:false) and are
// eligible for direct pre-fill the moment extraction succeeds. 'verified'-
// tier applications must reach 'reviewed' first (a human confirms every
// audit finding via the confirm-review route, which emits
// 'permit/application.review_confirmed'). Rather than branching on which
// event fired -- which would mean trusting the event's own name as a proxy
// for eligibility -- both triggers run the exact same re-derived-from-the-
// DB gate below (mirrors audit.ts's own "never trust the event payload,
// re-check coverage_level live" discipline). 'listed'-tier applications are
// never eligible, full stop -- there is no code path where a listed
// jurisdiction should have anything typed onto a legal form.
//
// idempotency is keyed on applicationId: a re-run for the same application
// (e.g. Inngest retry, or a second review-confirm somehow firing twice)
// should collapse rather than double-generate every filing's PDF.
export const permitGeneratePdf = inngest.createFunction(
  {
    id: 'permit-generate-pdf',
    name: 'Generate filled permit PDFs',
    triggers: [{ event: 'permit/application.audited' }, { event: 'permit/application.review_confirmed' }],
    idempotency: 'event.data.applicationId',
    retries: 2,
  },
  async ({ event, step }) => {
    // Both trigger events carry applicationId as their only field this
    // function cares about ('permit/application.audited' also carries
    // auditId/audited, deliberately unused here -- see header comment on why
    // eligibility is re-derived from the DB, never read off the event).
    const { applicationId } = event.data as { applicationId: string };
    const supabase = createServiceClient();

    const context = await step.run('load-context', async () => {
      const { data: application, error: appError } = await supabase
        .from('permit_applications')
        .select('id, org_id, contractor_id, permit_type_id, status, project_title, estimated_job_value_cents')
        .eq('id', applicationId)
        .single();
      if (appError || !application) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
      }

      const { data: permitType, error: permitTypeError } = await supabase
        .from('permit_types')
        .select('jurisdiction_id')
        .eq('id', application.permit_type_id)
        .single();
      if (permitTypeError || !permitType) {
        throw new Error(
          `permit_types row not found for ${application.permit_type_id}: ${permitTypeError?.message ?? 'no row'}`
        );
      }

      const { data: jurisdiction, error: jurisdictionError } = await supabase
        .from('jurisdictions')
        .select('coverage_level')
        .eq('id', permitType.jurisdiction_id)
        .single();
      if (jurisdictionError || !jurisdiction) {
        throw new Error(
          `jurisdictions row not found for ${permitType.jurisdiction_id}: ${jurisdictionError?.message ?? 'no row'}`
        );
      }

      // Latest extraction only -- an application could in principle have
      // more than one extractions row (a corrected re-extraction), and the
      // most recent one is the only honest source of "what the AI currently
      // believes about this document set". parsed_data is null both when no
      // extraction exists at all and when the latest one failed validation
      // (zod_valid=false leaves parsed_data null, per extract.ts) --
      // buildFieldResolutionContext treats both the same way (degrades to
      // extraction: null, application/contractor fields still resolve).
      const { data: latestExtraction, error: extractionError } = await supabase
        .from('extractions')
        .select('parsed_data')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (extractionError) {
        throw new Error(`Failed to load extractions for ${applicationId}: ${extractionError.message}`);
      }

      const { data: contractor, error: contractorError } = await supabase
        .from('contractors')
        .select('company_name, primary_license_number, license_province_code')
        .eq('id', application.contractor_id)
        .single();
      if (contractorError || !contractor) {
        throw new Error(
          `contractors row not found for ${application.contractor_id}: ${contractorError?.message ?? 'no row'}`
        );
      }

      const { data: filings, error: filingsError } = await supabase
        .from('permit_type_filings')
        .select('id, form_template_path')
        .eq('permit_type_id', application.permit_type_id);
      if (filingsError) {
        throw new Error(
          `Failed to load permit_type_filings for ${application.permit_type_id}: ${filingsError.message}`
        );
      }

      return {
        orgId: application.org_id as string,
        status: application.status as string,
        coverageLevel: jurisdiction.coverage_level as string,
        parsedData: (latestExtraction?.parsed_data ?? null) as Record<string, unknown> | null,
        estimatedJobValueCents: application.estimated_job_value_cents as number | null,
        projectTitle: application.project_title as string | null,
        contractor,
        filings: (filings ?? []) as { id: string; form_template_path: string | null }[],
      };
    });

    const eligible =
      context.coverageLevel !== 'listed' &&
      ((context.status === 'extracted' && context.coverageLevel === 'assisted') || context.status === 'reviewed');

    if (!eligible) {
      await step.sendEvent('emit-pdf-generated-skipped', {
        name: 'permit/application.pdf_generated',
        data: {
          applicationId,
          generatedDocumentIds: [],
          succeeded: false,
        } satisfies PermitEventPayloads['permit/application.pdf_generated'],
      });
      return { applicationId, generatedDocumentIds: [], succeeded: false };
    }

    await step.run('mark-generating', async () => {
      const { error } = await supabase
        .from('permit_applications')
        .update({ status: 'generating_documents' })
        .eq('id', applicationId);
      if (error) throw new Error(`Failed to set status=generating_documents: ${error.message}`);
    });

    const fieldContext = buildFieldResolutionContext({
      parsedData: context.parsedData,
      estimatedJobValueCents: context.estimatedJobValueCents,
      projectTitle: context.projectTitle,
      contractor: context.contractor,
    });

    const generatedDocumentIds: string[] = [];

    for (const filing of context.filings) {
      // No template yet for this filing -- e.g. a filing added to seed data
      // ahead of the actual PDF being sourced. Skipped, not an error: there
      // is nothing to fill, and that is a known, pre-existing data gap
      // (Phase 0/4 findings), not a bug in this run.
      if (!filing.form_template_path) continue;

      const result = await step.run(`generate-filing-${filing.id}`, async () => {
        const { data: fieldRows, error: fieldsError } = await supabase
          .from('permit_form_fields')
          .select('pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y')
          .eq('permit_type_filing_id', filing.id);
        if (fieldsError) {
          throw new Error(`Failed to load permit_form_fields for filing ${filing.id}: ${fieldsError.message}`);
        }
        // No field map yet either (the ESA/Calgary overlay-coordinate gap
        // documented in seed.sql: fabricating unmeasured pixel coordinates
        // for a real government form would misrepresent them as verified).
        // Skipped for the same "honest absence, not an error" reason as the
        // missing-template case above.
        if (!fieldRows || fieldRows.length === 0) {
          return null;
        }

        const { data: templateData, error: templateError } = await supabase.storage
          .from(FORM_TEMPLATES_BUCKET)
          .download(filing.form_template_path as string);
        if (templateError || !templateData) {
          throw new Error(
            `Failed to download template ${filing.form_template_path}: ${templateError?.message ?? 'no data'}`
          );
        }
        const templateBytes = new Uint8Array(await templateData.arrayBuffer());

        // Each filing is one fill method, never a mix -- permit_form_fields'
        // own check constraint (20260806000005) already forbids a single row
        // from having both pdf_field_name and overlay_* set, but nothing
        // stops two rows for the SAME filing from disagreeing with each
        // other; that would be a seed/data-integrity bug, and per this
        // codebase's "fail loudly on a data-integrity mismatch" posture
        // (fill-acroform.ts, overlay-coordinates.ts), it throws rather than
        // silently picking one method and dropping the other rows' fields.
        const isAcroform = fieldRows.every((f) => f.pdf_field_name !== null);
        const isOverlay = fieldRows.every((f) => f.pdf_field_name === null);
        if (!isAcroform && !isOverlay) {
          throw new Error(
            `permit_form_fields for filing ${filing.id} mixes AcroForm rows (pdf_field_name set) and overlay rows (overlay_* set) within the same filing -- each filing must use exactly one fill method.`
          );
        }

        const incompleteRequired: string[] = [];
        const incompleteOptional: string[] = [];
        let filledBytes: Uint8Array;
        const fillMethod: 'acroform' | 'overlay' = isAcroform ? 'acroform' : 'overlay';

        if (isAcroform) {
          const instructions: AcroFormFillInstruction[] = fieldRows.map((f) => {
            const resolved = resolveFieldForFilling(f.maps_to, fieldContext);
            if (resolved.value === null) {
              (f.is_required ? incompleteRequired : incompleteOptional).push(f.maps_to);
            }
            return { pdfFieldName: f.pdf_field_name as string, value: resolved.value };
          });
          filledBytes = (await fillAcroForm(templateBytes, instructions)).filledBytes;
        } else {
          const instructions: OverlayFillInstruction[] = fieldRows.map((f) => {
            const resolved = resolveFieldForFilling(f.maps_to, fieldContext);
            if (resolved.value === null) {
              (f.is_required ? incompleteRequired : incompleteOptional).push(f.maps_to);
            }
            return {
              page: f.overlay_page as number,
              x: Number(f.overlay_x),
              y: Number(f.overlay_y),
              value: resolved.value,
            };
          });
          filledBytes = (await fillOverlay(templateBytes, instructions)).filledBytes;
        }

        const filledBuffer = Buffer.from(filledBytes);
        const sha256 = computeSha256(filledBuffer);
        const originalFilename = `${filing.id}-filled.pdf`;
        // Load-bearing: the permitfield-generated bucket's RLS policy
        // (20260806000013_storage_buckets.sql) authorizes reads via
        // storage.foldername(name)[1]::uuid matched against is_org_member --
        // the FIRST path segment must be the org id, not the application id.
        // buildStoragePath is the one place that convention is encoded; a
        // bare `${applicationId}/...` path here would silently break every
        // contractor's ability to read their own generated PDF.
        const storagePath = buildStoragePath(context.orgId, applicationId, sha256, originalFilename);

        const { error: uploadError } = await supabase.storage
          .from(GENERATED_BUCKET)
          .upload(storagePath, filledBuffer, { contentType: 'application/pdf', upsert: false });
        if (uploadError) {
          throw new Error(`Failed to upload generated PDF to ${storagePath}: ${uploadError.message}`);
        }

        const { data: inserted, error: insertError } = await supabase
          .from('generated_documents')
          .insert({
            application_id: applicationId,
            permit_type_filing_id: filing.id,
            storage_path: storagePath,
            original_filename: originalFilename,
            fill_method: fillMethod,
            incomplete_required_fields: incompleteRequired,
            incomplete_optional_fields: incompleteOptional,
          })
          .select('id')
          .single();
        if (insertError || !inserted) {
          throw new Error(
            `Failed to insert generated_documents row for filing ${filing.id}: ${insertError?.message ?? 'no row returned'}`
          );
        }

        return { generatedDocumentId: inserted.id as string };
      });

      if (result) {
        generatedDocumentIds.push(result.generatedDocumentId);
      }
    }

    // Success means at least one filing actually produced a document.
    // Zero-out is possible (and honest) when every filing for this
    // permit_type is still missing a template and/or field map -- routed to
    // document_generation_failed rather than documents_generated, since
    // "generated" would misrepresent an application that has no filled PDF
    // at all.
    const succeeded = generatedDocumentIds.length > 0;

    await step.run('mark-final-status', async () => {
      const nextStatus = succeeded ? 'documents_generated' : 'document_generation_failed';
      const { error } = await supabase
        .from('permit_applications')
        .update({ status: nextStatus })
        .eq('id', applicationId);
      if (error) throw new Error(`Failed to set status=${nextStatus}: ${error.message}`);
    });

    await step.sendEvent('emit-pdf-generated-event', {
      name: 'permit/application.pdf_generated',
      data: {
        applicationId,
        generatedDocumentIds,
        succeeded,
      } satisfies PermitEventPayloads['permit/application.pdf_generated'],
    });

    return { applicationId, generatedDocumentIds, succeeded };
  }
);
