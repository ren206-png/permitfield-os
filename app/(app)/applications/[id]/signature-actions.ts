'use server';

import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { cancelPermitSignatureRequest, requestPermitSignature } from '@/lib/esign/permit-signatures';
import { createClient } from '@/lib/supabase/server';

export interface SignatureActionState {
  error?: string;
  message?: string;
  signUrl?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestSignatureAction(_prev: SignatureActionState, formData: FormData): Promise<SignatureActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const filingId = String(formData.get('filingId') ?? '');
  const signerRole = String(formData.get('signerRole') ?? '');
  if (!UUID_PATTERN.test(applicationId) || !UUID_PATTERN.test(filingId) || (signerRole !== 'applicant' && signerRole !== 'owner')) {
    return { error: 'Invalid request.' };
  }

  const { orgId, orgName, userId } = await requireOrgContext();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await requestPermitSignature(
    supabase,
    { orgId, orgName, userId, userEmail: user?.email ?? null },
    {
      applicationId,
      filingId,
      signerRole,
      signerName: String(formData.get('signerName') ?? ''),
      signerEmail: String(formData.get('signerEmail') ?? ''),
    }
  );
  revalidatePath(`/applications/${applicationId}`);
  if (!result.ok) return { error: result.error };
  return {
    signUrl: result.signUrl,
    message: result.emailed
      ? 'Signing link emailed. You can also copy it below.'
      : `The request was created but the email didn't send (${result.emailError?.replace(/\.$/, '')}). Copy the link below and send it yourself.`,
  };
}

export async function cancelSignatureAction(_prev: SignatureActionState, formData: FormData): Promise<SignatureActionState> {
  const applicationId = String(formData.get('applicationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  if (!UUID_PATTERN.test(applicationId) || !UUID_PATTERN.test(requestId)) return { error: 'Invalid request.' };

  await requireOrgContext();
  const result = await cancelPermitSignatureRequest(await createClient(), requestId);
  revalidatePath(`/applications/${applicationId}`);
  return result.ok ? { message: 'Request cancelled. The link no longer works.' } : { error: result.error };
}
