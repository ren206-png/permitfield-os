import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { centsToDollarsString } from '@/lib/money/cents';
import { UPLOADS_BUCKET, GENERATED_BUCKET } from '@/lib/storage/documents';
import { StatusBadge } from '@/components/status-badge';
import { CoverageBadge } from '@/components/coverage-badge';
import { DocumentUpload } from './document-upload';
import { FindingsList } from './findings-list';
import { ReviewActions } from './review-actions';
import type { PermitExtraction, ExtractedFieldKey } from '@/lib/ai/schemas/extraction';

const SIGNED_URL_TTL_SECONDS = 300;

const EXTRACTION_FIELD_LABELS: Record<ExtractedFieldKey, string> = {
  applicant_name: 'Applicant name',
  license_number: 'License number',
  square_footage: 'Square footage (m²)',
  electrical_amps: 'Electrical amps',
  estimated_job_value_raw: 'Estimated job value (as printed)',
  scope_of_work_summary: 'Scope of work',
};
const EXTRACTION_FIELD_ORDER = Object.keys(EXTRACTION_FIELD_LABELS) as ExtractedFieldKey[];

// requireOrgContext() re-derives org membership on every page load (this
// project's standing "re-derive from DB, don't thread trust through props"
// rule -- see app/(app)/layout.tsx's header comment); every query below is
// additionally filtered by RLS, so a well-formed :id belonging to another
// org resolves to notFound() here, the same 404-not-403 shape as the API
// routes in this same family (confirm-review, documents).
export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: applicationId } = await params;
  await requireOrgContext();
  const supabase = await createClient();

  const { data: application, error: applicationError } = await supabase
    .from('permit_applications')
    .select(
      `id, project_title, project_address, status, estimated_job_value_cents, currency_code, created_at,
       contractors ( company_name ),
       permit_types ( title, jurisdictions ( municipality, province_code, coverage_level ) )`
    )
    .eq('id', applicationId)
    .maybeSingle();

  if (applicationError) {
    throw new Error(`Failed to load application: ${applicationError.message}`);
  }
  if (!application) {
    notFound();
  }

  const contractor = Array.isArray(application.contractors) ? application.contractors[0] : application.contractors;
  const permitType = Array.isArray(application.permit_types) ? application.permit_types[0] : application.permit_types;
  const jurisdiction = permitType
    ? Array.isArray(permitType.jurisdictions)
      ? permitType.jurisdictions[0]
      : permitType.jurisdictions
    : null;
  const coverageLevel = jurisdiction?.coverage_level ?? 'listed';

  const [{ data: documents, error: documentsError }, { data: extraction, error: extractionError }, { data: latestAudit, error: auditError }, { data: generatedDocs, error: generatedError }] =
    await Promise.all([
      supabase
        .from('application_documents')
        .select('id, original_filename, mime_type, byte_size, doc_kind, storage_path, uploaded_at')
        .eq('application_id', applicationId)
        .order('uploaded_at', { ascending: false }),
      supabase
        .from('extractions')
        .select('id, parsed_data, zod_valid, created_at')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('audits')
        .select('id, created_at')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('generated_documents')
        .select('id, original_filename, storage_path, fill_method, incomplete_required_fields, incomplete_optional_fields, created_at')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false }),
    ]);

  if (documentsError || extractionError || auditError || generatedError) {
    throw new Error(
      `Failed to load application detail: ${documentsError?.message ?? extractionError?.message ?? auditError?.message ?? generatedError?.message}`
    );
  }

  let findings: {
    id: string;
    kind: string;
    severity: string;
    issue: string;
    action_required: string;
    confidence: number;
    review_status: string;
    codeChunk: { code_section: string; source_url: string } | null;
  }[] = [];

  if (latestAudit) {
    const { data: findingRows, error: findingsError } = await supabase
      .from('audit_findings')
      .select(
        'id, kind, severity, issue, action_required, confidence, review_status, jurisdiction_code_chunks ( code_section, source_url )'
      )
      .eq('audit_id', latestAudit.id)
      .order('created_at', { ascending: true });

    if (findingsError) {
      throw new Error(`Failed to load audit findings: ${findingsError.message}`);
    }

    findings = (findingRows ?? []).map((f) => {
      const chunk = Array.isArray(f.jurisdiction_code_chunks) ? f.jurisdiction_code_chunks[0] : f.jurisdiction_code_chunks;
      return {
        id: f.id,
        kind: f.kind,
        severity: f.severity,
        issue: f.issue,
        action_required: f.action_required,
        confidence: f.confidence,
        review_status: f.review_status,
        codeChunk: chunk ? { code_section: chunk.code_section, source_url: chunk.source_url } : null,
      };
    });
  }

  // Signed URLs are generated with the caller's own RLS-scoped session
  // (never service-client.ts) -- storage.objects' uploads_select /
  // generated_select policies (migration 20260806000013) gate this the same
  // way they'd gate a direct download, so a signing call for another org's
  // object fails here rather than producing a URL that happens to work.
  const documentsWithUrls = await Promise.all(
    (documents ?? []).map(async (doc) => {
      const { data: signed } = await supabase.storage.from(UPLOADS_BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...doc, signedUrl: signed?.signedUrl ?? null };
    })
  );

  const generatedDocsWithUrls = await Promise.all(
    (generatedDocs ?? []).map(async (doc) => {
      const { data: signed } = await supabase.storage.from(GENERATED_BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...doc, signedUrl: signed?.signedUrl ?? null };
    })
  );

  const documentFilenameById = new Map((documents ?? []).map((d) => [d.id, d.original_filename]));
  const parsedExtraction = extraction?.zod_valid ? (extraction.parsed_data as PermitExtraction | null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{application.project_title}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">{application.project_address}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={application.status} />
            <CoverageBadge coverageLevel={coverageLevel} />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Permit type</dt>
            <dd className="text-zinc-900">{permitType?.title ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Jurisdiction</dt>
            <dd className="text-zinc-900">
              {jurisdiction ? `${jurisdiction.municipality}, ${jurisdiction.province_code}` : 'Unknown'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Contractor</dt>
            <dd className="text-zinc-900">{contractor?.company_name ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Estimated job value</dt>
            <dd className="text-zinc-900">
              {application.estimated_job_value_cents != null
                ? `${centsToDollarsString(BigInt(application.estimated_job_value_cents))} ${application.currency_code}`
                : 'Not provided'}
            </dd>
          </div>
        </dl>
      </div>

      <ReviewActions applicationId={applicationId} status={application.status} />

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Documents</h2>
        <div className="mt-2 flex flex-col gap-3">
          <DocumentUpload applicationId={applicationId} />
          {documentsWithUrls.length > 0 ? (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
              {documentsWithUrls.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900">{doc.original_filename}</p>
                    <p className="text-xs text-zinc-500">
                      {doc.doc_kind} · {Math.round(doc.byte_size / 1024)} KB
                    </p>
                  </div>
                  {doc.signedUrl && (
                    <a href={doc.signedUrl} target="_blank" rel="noreferrer noopener" className="text-xs font-medium text-zinc-700 underline">
                      Download
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No documents uploaded yet.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Extraction summary</h2>
        {parsedExtraction ? (
          <dl className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2">
            {EXTRACTION_FIELD_ORDER.map((key) => {
              const field = parsedExtraction[key];
              return (
                <div key={key}>
                  <dt className="text-xs font-medium text-zinc-500">{EXTRACTION_FIELD_LABELS[key]}</dt>
                  <dd className="text-sm text-zinc-900">
                    {field.value != null ? String(field.value) : <span className="text-zinc-400">Not found</span>}
                  </dd>
                  {field.value != null && (
                    <p className="text-xs text-zinc-400">
                      Confidence: {Math.round(field.confidence * 100)}%
                      {field.source_document_id && documentFilenameById.get(field.source_document_id)
                        ? ` · ${documentFilenameById.get(field.source_document_id)}${field.source_page ? `, p.${field.source_page}` : ''}`
                        : ''}
                    </p>
                  )}
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            {extraction && !extraction.zod_valid
              ? 'The last extraction attempt failed validation. Re-upload or contact support.'
              : 'No extraction yet. Upload documents and check "start AI extraction" above.'}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Audit findings</h2>
        <div className="mt-2">
          <FindingsList applicationId={applicationId} findings={findings} coverageLevel={coverageLevel} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Generated documents</h2>
        {generatedDocsWithUrls.length > 0 ? (
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {generatedDocsWithUrls.map((doc) => {
              const missingRequired = Array.isArray(doc.incomplete_required_fields) ? doc.incomplete_required_fields.length : 0;
              return (
                <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900">{doc.original_filename}</p>
                    <p className="text-xs text-zinc-500">
                      {doc.fill_method}
                      {missingRequired > 0 && (
                        <span className="text-amber-700"> · {missingRequired} required field(s) left blank -- review before filing</span>
                      )}
                    </p>
                  </div>
                  {doc.signedUrl && (
                    <a href={doc.signedUrl} target="_blank" rel="noreferrer noopener" className="text-xs font-medium text-zinc-700 underline">
                      Download
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No documents generated yet.</p>
        )}
      </section>
    </div>
  );
}
