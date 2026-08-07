import Anthropic from '@anthropic-ai/sdk';
import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isAiAuditEnabled } from '@/lib/flags';
import { auditPermitData } from '@/lib/ai/audit-permit-data';
import { buildAuditQueryText, retrieveCodeChunks } from '@/lib/ai/retrieve-code-chunks';
import { PermitExtractionSchema } from '@/lib/ai/schemas/extraction';
import type { AuditFinding } from '@/lib/ai/schemas/audit';

// permit.audit: compares an application's extracted facts against retrieved
// jurisdiction code excerpts and persists an audits/audit_findings result.
// Triggered by 'permit/application.extracted' -- the success/failure signal
// from lib/inngest/functions/extract.ts.
//
// idempotency is keyed on extractionId, not applicationId, deliberately
// different from permit.extract's own idempotency key: an application could
// in principle be re-extracted (a new extractions row), and each distinct
// extraction should be auditable on its own -- collapsing on applicationId
// would silently drop a legitimate re-audit after a corrected re-extraction.
export const permitAudit = inngest.createFunction(
  {
    id: 'permit-audit',
    name: 'Audit permit application against jurisdiction code',
    triggers: [{ event: 'permit/application.extracted' }],
    idempotency: 'event.data.extractionId',
    retries: 2,
  },
  async ({ event, step }) => {
    const { applicationId, extractionId, zodValid } =
      event.data as PermitEventPayloads['permit/application.extracted'];
    const supabase = createServiceClient();

    // Extraction itself failed validation -- there is no parsed_data to
    // audit against. permit_applications.status is already 'extraction_failed'
    // (set by permit.extract); left untouched here rather than overwritten.
    if (!zodValid) {
      await step.sendEvent('emit-audited-skipped-extraction-failed', {
        name: 'permit/application.audited',
        data: { applicationId, auditId: null, audited: false } satisfies PermitEventPayloads['permit/application.audited'],
      });
      return { applicationId, auditId: null, audited: false };
    }

    const context = await step.run('load-context', async () => {
      const { data: extraction, error: extractionError } = await supabase
        .from('extractions')
        .select('parsed_data')
        .eq('id', extractionId)
        .single();
      if (extractionError || !extraction || !extraction.parsed_data) {
        throw new Error(
          `extractions row not found or has no parsed_data for ${extractionId}: ${extractionError?.message ?? 'no row'}`
        );
      }

      const { data: application, error: appError } = await supabase
        .from('permit_applications')
        .select('id, permit_type_id')
        .eq('id', applicationId)
        .single();
      if (appError || !application) {
        throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
      }

      const { data: permitType, error: permitTypeError } = await supabase
        .from('permit_types')
        .select('title, jurisdiction_id, compliance_rules')
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

      const { data: documents, error: documentsError } = await supabase
        .from('application_documents')
        .select('doc_kind')
        .eq('application_id', applicationId);
      if (documentsError) {
        throw new Error(`Failed to load application_documents for ${applicationId}: ${documentsError.message}`);
      }

      return {
        parsedData: extraction.parsed_data as Record<string, unknown>,
        permitTypeTitle: permitType.title as string,
        complianceRules: permitType.compliance_rules as unknown,
        jurisdictionId: jurisdiction.id as string,
        coverageLevel: jurisdiction.coverage_level as string,
        presentDocKinds: (documents ?? []).map((d) => d.doc_kind as string),
      };
    });

    // Both an ops-level kill switch (the flag) and a per-jurisdiction
    // product-tier gate (coverage_level) must independently allow the model
    // to run -- see lib/flags.ts's isAiAuditEnabled comment for why these
    // are deliberately kept as two separate checks rather than folded into
    // one. When gated off, an audits row is deliberately NOT inserted:
    // README.md's safety rule is that a listed/assisted jurisdiction (or an
    // audit-disabled flag state) must never present an empty findings list
    // as if it were a clean audit result. "No audits row exists yet" is the
    // honest, UI-distinguishable signal for "not yet covered" -- inserting
    // one with zero findings here would look identical to a genuinely clean
    // 'verified'-jurisdiction audit to any later reader of the table.
    if (!isAiAuditEnabled() || context.coverageLevel !== 'verified') {
      await step.sendEvent('emit-audited-skipped-not-covered', {
        name: 'permit/application.audited',
        data: { applicationId, auditId: null, audited: false } satisfies PermitEventPayloads['permit/application.audited'],
      });
      return { applicationId, auditId: null, audited: false };
    }

    await step.run('mark-auditing', async () => {
      const { error } = await supabase
        .from('permit_applications')
        .update({ status: 'auditing' })
        .eq('id', applicationId);
      if (error) throw new Error(`Failed to set status=auditing: ${error.message}`);
    });

    // Re-parsing extraction.parsed_data through the same schema it was
    // validated against at write time (lib/inngest/functions/extract.ts),
    // rather than trusting the jsonb column's shape blindly. This also
    // strips the estimated_job_value_cents field extract.ts adds on top of
    // PermitExtractionSchema's own fields (Zod objects strip unknown keys by
    // default) -- the audit model only ever needs the model-extracted
    // fields, never the deterministically-computed cents value. A parse
    // failure here throws (a genuine data-integrity error, not a normal
    // fail-closed path), which Inngest's own `retries: 2` covers.
    const extraction = PermitExtractionSchema.parse(context.parsedData);

    const retrievedChunks = await step.run('retrieve-code-chunks', async () => {
      const queryText = buildAuditQueryText({ permitTypeTitle: context.permitTypeTitle, extraction });
      return retrieveCodeChunks(supabase, context.jurisdictionId, queryText);
    });

    const modelResult = await step.run('call-model-and-validate', async () => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      return auditPermitData(client, extraction, retrievedChunks);
    });

    const persisted = await step.run('persist-audit', async () => {
      // Fail closed (global engineering rule, mirrors extract.ts's
      // zod_valid=false handling): every model attempt failed structural
      // validation, so no audits row is inserted at all -- never a partial
      // or empty-looking "clean" result.
      if (!modelResult.structurallyValid) {
        const { error: statusError } = await supabase
          .from('permit_applications')
          .update({ status: 'audit_failed' })
          .eq('id', applicationId);
        if (statusError) throw new Error(`Failed to set status=audit_failed: ${statusError.message}`);
        return { auditId: null as string | null };
      }

      // SS4.3: compliance_rules is checked in application code, not by the
      // AI. This is computed here, deterministically, from data the model
      // was never even shown -- see lib/ai/audit-permit-data.ts's header
      // comment for why the model is explicitly forbidden from producing
      // this finding kind itself.
      const missingDocumentFindings = computeMissingDocumentFindings(
        context.complianceRules,
        new Set(context.presentDocKinds)
      );

      // Each retrieved chunk carries its own source table's corpus_version;
      // when more than one distinct value appears in one retrieval (an
      // in-progress re-ingestion straddling two versions), all of them are
      // recorded rather than arbitrarily picking one. 'no-corpus-ingested'
      // is an honest, explicit sentinel for the current real state of this
      // codebase -- zero jurisdiction_code_chunks rows exist anywhere yet --
      // rather than leaving the NOT NULL corpus_version column to a
      // fabricated-looking value.
      const corpusVersion =
        retrievedChunks.length > 0
          ? [...new Set(retrievedChunks.map((c) => c.corpusVersion))].sort().join('+')
          : 'no-corpus-ingested';

      const { data: insertedAudit, error: auditInsertError } = await supabase
        .from('audits')
        .insert({
          application_id: applicationId,
          model_id: modelResult.modelId,
          prompt_version: modelResult.promptVersion,
          corpus_version: corpusVersion,
        })
        .select('id')
        .single();
      if (auditInsertError || !insertedAudit) {
        throw new Error(`Failed to insert audits row: ${auditInsertError?.message ?? 'no row returned'}`);
      }
      const auditId = insertedAudit.id as string;

      const allFindings: AuditFinding[] = [...missingDocumentFindings, ...modelResult.findings];
      if (allFindings.length > 0) {
        const { error: findingsError } = await supabase.from('audit_findings').insert(
          allFindings.map((f) => ({
            audit_id: auditId,
            kind: f.kind,
            severity: f.severity,
            issue: f.issue,
            action_required: f.action_required,
            code_chunk_id: f.code_chunk_id,
            confidence: f.confidence,
          }))
        );
        if (findingsError) {
          throw new Error(`Failed to insert audit_findings rows: ${findingsError.message}`);
        }
      }

      // SS6 citation-validity-rate metric's source table -- rejections are
      // persisted, never silently dropped, so hallucination rate can
      // actually be measured (see 20260806000010_ai_findings_rejected.sql).
      if (modelResult.rejected.length > 0) {
        const { error: rejectedError } = await supabase.from('ai_findings_rejected').insert(
          modelResult.rejected.map((r) => ({
            application_id: applicationId,
            audit_id: auditId,
            raw_finding: r.rawFinding as object,
            rejection_reason: r.reason,
            model_id: modelResult.modelId,
            prompt_version: modelResult.promptVersion,
          }))
        );
        if (rejectedError) {
          throw new Error(`Failed to insert ai_findings_rejected rows: ${rejectedError.message}`);
        }
      }

      const { error: statusError } = await supabase
        .from('permit_applications')
        .update({ status: 'ready_for_review' })
        .eq('id', applicationId);
      if (statusError) {
        throw new Error(`Failed to set status=ready_for_review: ${statusError.message}`);
      }

      return { auditId };
    });

    await step.sendEvent('emit-audited-event', {
      name: 'permit/application.audited',
      data: {
        applicationId,
        auditId: persisted.auditId,
        audited: persisted.auditId !== null,
      } satisfies PermitEventPayloads['permit/application.audited'],
    });

    return { applicationId, auditId: persisted.auditId, audited: persisted.auditId !== null };
  }
);

interface ComplianceRules {
  requires_document_kinds?: string[];
}

/**
 * Pure, deterministic, model-free comparison of a permit type's required
 * document kinds against what was actually uploaded (SS4.3). Confidence is
 * always 1 -- this isn't a probabilistic judgment, it's a set-membership
 * check against data the application code already has ground truth for.
 * Exported (not just used locally) so eval/run.ts's offline checks can
 * exercise this exact function directly.
 */
export function computeMissingDocumentFindings(
  complianceRules: unknown,
  presentDocKinds: Set<string>
): AuditFinding[] {
  const rules = (complianceRules ?? {}) as ComplianceRules;
  const requiredKinds = rules.requires_document_kinds ?? [];

  const findings: AuditFinding[] = [];
  for (const kind of requiredKinds) {
    if (!presentDocKinds.has(kind)) {
      findings.push({
        kind: 'missing_document',
        severity: 'critical',
        issue: `No uploaded document of kind "${kind}" was found for this application.`,
        action_required: `Upload a document of kind "${kind}" before this application can be reviewed.`,
        code_chunk_id: null,
        confidence: 1,
      });
    }
  }
  return findings;
}
