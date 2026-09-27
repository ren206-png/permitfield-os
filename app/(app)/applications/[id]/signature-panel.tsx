import { createClient } from '@/lib/supabase/server';
import { CancelSignatureButton, RequestSignatureForm } from './signature-controls';

// "Signatures" panel (PERMITFIELD_FF_PERMIT_ESIGN). One row per filing whose
// form has a signature line. Signing is offered only where the authority has
// confirmed it accepts electronic signatures; elsewhere the form is printed
// and signed by hand, and the panel says so.

interface Authority {
  name: string;
  esignature_accepted: boolean;
  esignature_source_url: string | null;
}

interface FilingRow {
  id: string;
  authorities: Authority | Authority[] | null;
  permit_form_signature_slots: { signer_role: 'applicant' | 'owner' }[] | null;
}

interface RequestRow {
  id: string;
  permit_type_filing_id: string;
  signer_role: 'applicant' | 'owner';
  signer_name: string;
  signer_email: string;
  status: 'pending' | 'signed' | 'cancelled';
  created_at: string;
  signed_at: string | null;
}

const ROLE_LABEL = { applicant: 'Applicant', owner: 'Property owner' } as const;

export async function SignaturePanel({
  orgId,
  applicationId,
  permitTypeId,
  applicationStatus,
  defaultSignerName,
  defaultSignerEmail,
}: {
  orgId: string;
  applicationId: string;
  permitTypeId: string;
  applicationStatus: string;
  defaultSignerName: string;
  defaultSignerEmail: string;
}) {
  const supabase = await createClient();
  const [{ data: filings, error: filingsError }, { data: requests }, { data: canRequest }] = await Promise.all([
    supabase
      .from('permit_type_filings')
      .select('id, authorities ( name, esignature_accepted, esignature_source_url ), permit_form_signature_slots ( signer_role )')
      .eq('permit_type_id', permitTypeId)
      .order('sequence', { ascending: true }),
    supabase
      .from('permit_signature_requests')
      .select('id, permit_type_filing_id, signer_role, signer_name, signer_email, status, created_at, signed_at')
      .eq('application_id', applicationId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false }),
    supabase.rpc('can_submit_filings', { check_org_id: orgId }),
  ]);
  if (filingsError) {
    throw new Error(`Failed to load filings: ${filingsError.message}`);
  }

  const rows = ((filings ?? []) as FilingRow[]).filter((f) => (f.permit_form_signature_slots ?? []).length > 0);
  if (rows.length === 0) return null;
  const open = applicationStatus === 'documents_generated';

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Signatures</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Send the filled form to be signed electronically. The signed copy replaces the unsigned one, so it&apos;s what gets submitted.
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {rows.map((filing) => {
          const authority = Array.isArray(filing.authorities) ? filing.authorities[0] : filing.authorities;
          if (!authority) return null;
          return (
            <li key={filing.id} className="rounded-md border border-zinc-200 p-3">
              <p className="text-sm font-medium text-zinc-900">{authority.name}</p>
              {!authority.esignature_accepted ? (
                <p className="mt-1 text-xs text-zinc-600">
                  {authority.name} hasn&apos;t confirmed it accepts electronic signatures on this form, so print it and sign by hand.
                </p>
              ) : (
                (filing.permit_form_signature_slots ?? []).map(({ signer_role: role }) => {
                  const latest = ((requests ?? []) as RequestRow[]).find(
                    (r) => r.permit_type_filing_id === filing.id && r.signer_role === role
                  );
                  return (
                    <div key={role} className="mt-2">
                      <p className="text-xs font-medium text-zinc-700">{ROLE_LABEL[role]} signature</p>
                      {latest?.status === 'signed' ? (
                        <p className="mt-1 text-xs text-emerald-700">
                          Signed by {latest.signer_name} on {new Date(latest.signed_at ?? latest.created_at).toLocaleString()}.
                        </p>
                      ) : latest?.status === 'pending' ? (
                        <div className="mt-1 text-xs text-zinc-600">
                          Waiting for {latest.signer_name} ({latest.signer_email}), sent {new Date(latest.created_at).toLocaleString()}.{' '}
                          {canRequest && open && <CancelSignatureButton applicationId={applicationId} requestId={latest.id} />}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-zinc-600">Not signed yet.</p>
                      )}
                      {canRequest && open && latest?.status !== 'signed' && (
                        <div className="mt-2">
                          <RequestSignatureForm
                            applicationId={applicationId}
                            filingId={filing.id}
                            signerRole={role}
                            defaultName={latest?.signer_name ?? defaultSignerName}
                            defaultEmail={latest?.signer_email ?? defaultSignerEmail}
                            submitLabel={latest?.status === 'pending' ? 'Send a new link' : 'Send for signature'}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {authority.esignature_accepted && authority.esignature_source_url && (
                <p className="mt-2 text-[11px] text-zinc-400">
                  {authority.name} accepts electronic signatures on this form (
                  <a href={authority.esignature_source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    source
                  </a>
                  ).
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {!open && <p className="mt-3 text-xs text-zinc-500">Signing is available once the forms are generated and before the application is submitted.</p>}
    </section>
  );
}
