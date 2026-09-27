import { notFound } from 'next/navigation';
import { resolveTargetToken, getBridgeRequestContext } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { loadSigningView } from '@/lib/esign/permit-signatures';
import { SignPermitForm } from './sign-permit-form';

// E-signature, Stage B: the page a signer opens from their emailed link to
// review and sign a filled city permit form. Authorized only by its bearer
// token -- every bad, expired, revoked or flag-disabled token is the same
// 404 (see app/estimate/[token]/page.tsx for the full reasoning).
export const dynamic = 'force-dynamic';

export default async function SignPermitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveTargetToken(token, 'permit_signature', await getBridgeRequestContext());
  if ('error' in resolved) {
    notFound();
  }

  // Trust boundary: service-role client only after the token resolved, every
  // query scoped by its orgId/targetId (lib/supabase/service-client.ts,
  // Exception 2).
  const view = await loadSigningView(createServiceClient(), resolved.orgId, resolved.targetId);
  if (!view || view.status === 'cancelled') {
    notFound();
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-16">
      <p className="text-sm text-zinc-500">{view.organizationName}</p>
      <h1 className="mt-1 text-xl font-semibold text-zinc-900">Sign the {view.permitTypeTitle} application</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {view.projectAddress} · to {view.authorityName}
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {view.status === 'signed' ? (
          <p className="text-sm font-medium text-emerald-700">
            Signed{view.signedAt ? ` on ${new Date(view.signedAt).toLocaleDateString('en-CA')}` : ''}. Thank you -- {view.organizationName} has the
            signed form.
          </p>
        ) : !view.applicationOpen || !view.document ? (
          <p className="text-sm text-zinc-600">This form is not open for signing right now. Contact {view.organizationName} for an updated link.</p>
        ) : (
          <>
            <h2 className="text-sm font-medium text-zinc-900">1. Review the form</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {view.organizationName} filled this form in for you. Read it before signing -- your signature confirms it is accurate.
            </p>
            <a
              href={`/api/public/sign/${token}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Open the filled form (PDF)
            </a>

            <h2 className="mt-6 text-sm font-medium text-zinc-900">2. Sign</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Your signature, name and today&apos;s date are added to the form&apos;s signature line. {view.authorityName} accepts electronic
              signatures on this form.
            </p>
            <div className="mt-3">
              <SignPermitForm token={token} documentId={view.document.id} defaultName={view.signerName} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
