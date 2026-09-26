import { createClient } from '@/lib/supabase/server';
import { GENERATED_BUCKET } from '@/lib/storage/documents';
import { resolveSubmissionRecipient } from '@/lib/submissions/recipient';
import { EmailSubmitButton, RecordSubmissionForm } from './submission-controls';

// "Submit to authority" panel (PERMITFIELD_FF_CITY_SUBMISSION). One card per
// filing the permit type requires, shaped by how that authority takes
// filings: email (only when its intake address is verified), online portal,
// or in person. The filled form for each filing comes from the latest
// generated_documents row for it.

interface Authority {
  id: string;
  name: string;
  filing_mechanism: 'portal' | 'pdf_email' | 'in_person' | 'api' | null;
  portal_url: string | null;
  submission_email: string | null;
  submission_email_source_url: string | null;
  submission_email_verified_on: string | null;
  submission_instructions: string | null;
  office_address: string | null;
}

interface Filing {
  id: string;
  sequence: number;
  is_conditional_on: { trigger?: string } | null;
  authorities: Authority | Authority[] | null;
}

interface SubmissionRow {
  id: string;
  permit_type_filing_id: string;
  method: 'email' | 'portal' | 'in_person';
  status: 'sent' | 'failed' | 'recorded';
  to_email: string | null;
  external_reference: string | null;
  error_message: string | null;
  created_at: string;
}

const SIGNED_URL_TTL_SECONDS = 300;

function humanize(trigger: string): string {
  return trigger.replace(/_/g, ' ');
}

function describeSubmission(row: SubmissionRow): string {
  const when = new Date(row.created_at).toLocaleString();
  if (row.method === 'email') {
    return row.status === 'sent' ? `Emailed to ${row.to_email} · ${when}` : `Email to ${row.to_email} failed · ${when}`;
  }
  const how = row.method === 'portal' ? 'Submitted online' : 'Filed in person';
  return `${how}${row.external_reference ? ` · ref ${row.external_reference}` : ''} · ${when}`;
}

export async function SubmissionPanel({
  orgId,
  applicationId,
  permitTypeId,
  projectAddress,
}: {
  orgId: string;
  applicationId: string;
  permitTypeId: string;
  projectAddress: string;
}) {
  const supabase = await createClient();

  const [{ data: filings, error: filingsError }, { data: generated }, { data: submissions }] = await Promise.all([
    supabase
      .from('permit_type_filings')
      .select(
        'id, sequence, is_conditional_on, authorities ( id, name, filing_mechanism, portal_url, submission_email, submission_email_source_url, submission_email_verified_on, submission_instructions, office_address )'
      )
      .eq('permit_type_id', permitTypeId)
      .order('sequence', { ascending: true }),
    supabase
      .from('generated_documents')
      .select('permit_type_filing_id, storage_path, created_at')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false }),
    supabase
      .from('filing_submissions')
      .select('id, permit_type_filing_id, method, status, to_email, external_reference, error_message, created_at')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false }),
  ]);
  if (filingsError) {
    throw new Error(`Failed to load filings: ${filingsError.message}`);
  }

  const { data: canSubmit } = await supabase.rpc('can_submit_filings', { check_org_id: orgId });

  const latestByFiling = new Map<string, string>();
  for (const doc of generated ?? []) {
    if (!latestByFiling.has(doc.permit_type_filing_id)) {
      latestByFiling.set(doc.permit_type_filing_id, doc.storage_path);
    }
  }
  const paths = [...latestByFiling.values()];
  const { data: signed } = paths.length
    ? await supabase.storage.from(GENERATED_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const rows = (filings ?? []) as Filing[];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Submit to authority</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Each authority below needs its own filing. Emails go from PermitField on your behalf; replies come straight back to you.
      </p>
      {!canSubmit && (
        <p className="mt-2 text-xs text-amber-700">Only owners and permit managers can submit. You can see the status here.</p>
      )}

      <ul className="mt-4 flex flex-col gap-4">
        {rows.map((filing) => {
          const authority = Array.isArray(filing.authorities) ? filing.authorities[0] : filing.authorities;
          if (!authority) return null;
          const formPath = latestByFiling.get(filing.id);
          const formUrl = formPath ? urlByPath.get(formPath) : undefined;
          const history = (submissions ?? []).filter((s) => s.permit_type_filing_id === filing.id) as SubmissionRow[];
          const canEmail = authority.filing_mechanism === 'pdf_email' && Boolean(authority.submission_email) && Boolean(formPath);
          // Same rule the server action applies, so what the user is shown
          // (and confirms) is where the email will actually go.
          const recipient = resolveSubmissionRecipient({
            authorityEmail: authority.submission_email,
            vercelEnv: process.env.VERCEL_ENV,
            overrideEmail: process.env.PERMITFIELD_SUBMISSION_EMAIL_OVERRIDE,
          });
          const recordMethod = authority.filing_mechanism === 'in_person' ? 'in_person' : 'portal';

          return (
            <li key={filing.id} className="rounded-md border border-zinc-200 p-3">
              <p className="text-sm font-medium text-zinc-900">{authority.name}</p>
              {filing.is_conditional_on?.trigger && (
                <p className="mt-0.5 text-xs text-zinc-500">Only required if: {humanize(filing.is_conditional_on.trigger)}</p>
              )}

              <p className="mt-2 text-xs text-zinc-700">
                {formUrl ? (
                  <a href={formUrl} className="font-medium text-zinc-900 underline underline-offset-2">
                    Download filled form
                  </a>
                ) : (
                  'No filled form has been generated for this filing.'
                )}
              </p>

              {authority.submission_instructions && (
                <p className="mt-2 rounded bg-zinc-50 p-2 text-xs text-zinc-700">{authority.submission_instructions}</p>
              )}

              <div className="mt-3">
                {canEmail && canSubmit ? (
                  <>
                    <p className="mb-2 text-xs text-zinc-600">
                      Emails the filled form, with download links for your documents, to{' '}
                      <span className="font-medium">{authority.submission_email}</span> (address verified from{' '}
                      <a href={authority.submission_email_source_url ?? '#'} className="underline underline-offset-2" target="_blank" rel="noreferrer">
                        the authority&apos;s own site
                      </a>{' '}
                      on {authority.submission_email_verified_on}).
                    </p>
                    {recipient.ok ? (
                      <>
                        {recipient.overridden && (
                          <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
                            Test mode: this email will go to <span className="font-medium">{recipient.to}</span>, not to{' '}
                            {authority.name}.
                          </p>
                        )}
                        <EmailSubmitButton
                          applicationId={applicationId}
                          filingId={filing.id}
                          authorityName={authority.name}
                          toEmail={recipient.to}
                          projectAddress={projectAddress}
                          testMode={recipient.overridden}
                        />
                      </>
                    ) : (
                      <p className="text-xs text-amber-700">{recipient.error}</p>
                    )}
                  </>
                ) : authority.filing_mechanism !== 'pdf_email' || !authority.submission_email ? (
                  <>
                    <p className="mb-2 text-xs text-zinc-600">
                      {recordMethod === 'in_person'
                        ? `File in person${authority.office_address ? ` at ${authority.office_address}` : ''}. Bring the filled form and your documents.`
                        : 'Upload the filled form and your documents through the authority’s online portal.'}{' '}
                      {authority.portal_url && (
                        <a href={authority.portal_url} className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer">
                          {recordMethod === 'in_person' ? 'Authority details' : 'Open portal'}
                        </a>
                      )}
                    </p>
                    {canSubmit && <RecordSubmissionForm applicationId={applicationId} filingId={filing.id} method={recordMethod} />}
                  </>
                ) : null}
              </div>

              {history.length > 0 && (
                <ul className="mt-3 border-t border-zinc-100 pt-2 text-xs text-zinc-600">
                  {history.map((row) => (
                    <li key={row.id} className={row.status === 'failed' ? 'text-red-600' : undefined}>
                      {describeSubmission(row)}
                      {row.status === 'failed' && row.error_message ? ` -- ${row.error_message}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
