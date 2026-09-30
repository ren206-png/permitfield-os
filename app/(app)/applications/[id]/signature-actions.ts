'use server';

import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { cancelPermitSignatureRequest, requestPermitSignature } from '@/lib/esign/permit-signatures';
import { buildStoragePath, GENERATED_BUCKET, MAX_FILE_SIZE_BYTES } from '@/lib/storage/documents';
import { createServiceClient } from '@/lib/supabase/service-client';
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

// "Signed on paper? Upload the signed copy." Two steps, so large scans don't
// pass through a Server Action (1 MB limit) or a Vercel function (4.5 MB):
//   1. prepare: authorize, then hand the browser a one-time signed upload URL
//      for a path under this org/application, named by the file's sha256;
//   2. record: check the stored file really is a PDF, then record it through
//      record_uploaded_signed_form(), which re-checks the role and path.
// The uploaded PDF becomes the filing's latest document, so it is what gets
// downloaded and submitted. See lib/supabase/service-client.ts, Exception 4.
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type SignedUploadAuth =
  | { error: string }
  | { orgId: string; supabase: Awaited<ReturnType<typeof createClient>> };

async function authorizeSignedUpload(applicationId: string, filingId: string): Promise<SignedUploadAuth> {
  if (!UUID_PATTERN.test(applicationId) || !UUID_PATTERN.test(filingId)) return { error: 'Invalid request.' };
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc('can_submit_filings', { check_org_id: orgId });
  if (allowed !== true) return { error: 'Only owners and permit managers can upload a signed form.' };
  return { orgId, supabase };
}

export async function prepareSignedFormUploadAction(input: {
  applicationId: string;
  filingId: string;
  sha256: string;
  size: number;
}): Promise<{ error: string } | { path: string; token: string }> {
  const auth = await authorizeSignedUpload(input.applicationId, input.filingId);
  if ('error' in auth) return { error: auth.error };
  if (!SHA256_PATTERN.test(input.sha256)) return { error: 'Invalid file.' };
  if (!(input.size > 0) || input.size > MAX_FILE_SIZE_BYTES) return { error: 'That file is too large (25 MB maximum).' };

  const path = buildStoragePath(auth.orgId, input.applicationId, input.sha256, `${input.filingId}-signed-upload.pdf`);
  const { data, error } = await createServiceClient().storage.from(GENERATED_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return { error: `Could not start the upload: ${error?.message ?? 'unknown error'}` };
  return { path: data.path, token: data.token };
}

export async function recordSignedFormUploadAction(input: {
  applicationId: string;
  filingId: string;
  path: string;
}): Promise<SignatureActionState> {
  const auth = await authorizeSignedUpload(input.applicationId, input.filingId);
  if ('error' in auth) return { error: auth.error };
  const filename = `${input.filingId}-signed-upload.pdf`;
  if (!input.path.startsWith(`${auth.orgId}/${input.applicationId}/`) || !input.path.endsWith(`-${filename}`)) {
    return { error: 'Invalid upload.' };
  }

  const service = createServiceClient();
  const { data: blob, error: downloadError } = await service.storage.from(GENERATED_BUCKET).download(input.path);
  if (downloadError || !blob) return { error: 'The upload did not arrive. Try again.' };
  const head = Buffer.from(await blob.slice(0, 5).arrayBuffer()).toString('latin1');
  if (head !== '%PDF-') {
    await service.storage.from(GENERATED_BUCKET).remove([input.path]);
    return { error: 'Upload the signed form as a PDF.' };
  }

  const { error } = await auth.supabase.rpc('record_uploaded_signed_form', {
    p_application_id: input.applicationId,
    p_permit_type_filing_id: input.filingId,
    p_storage_path: input.path,
    p_filename: filename,
  });
  revalidatePath(`/applications/${input.applicationId}`);
  if (error) {
    const reason = /^[a-z_]+: (.+)$/.exec(error.message)?.[1];
    return { error: reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` : 'Could not save the signed form.' };
  }
  return { message: 'Signed copy uploaded. It is now the form that gets downloaded and submitted.' };
}
