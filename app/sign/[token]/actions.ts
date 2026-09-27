'use server';

import { revalidatePath } from 'next/cache';
import { getBridgeRequestContext, resolveTargetToken } from '@/lib/bridge/client-portal';
import { parseSignatureSubmission } from '@/lib/esign/signature';
import { signPermitForm } from '@/lib/esign/permit-signatures';
import { createServiceClient } from '@/lib/supabase/service-client';

// Same generic-failure discipline as app/estimate/[token]/actions.ts: every
// token-validation failure is the same message; a form that changed while
// the page was open gets its own, since refreshing is how the signer recovers.
const GENERIC_ERROR = 'This link is no longer available. Please contact the sender for an updated link.';

export interface SignPermitFormState {
  error?: string;
  signed?: boolean;
}

export async function signPermitFormAction(_prev: SignPermitFormState, formData: FormData): Promise<SignPermitFormState> {
  const token = String(formData.get('token') ?? '').trim();
  const documentId = String(formData.get('documentId') ?? '').trim();
  const typedName = String(formData.get('typedName') ?? '').trim();
  if (!token || !documentId) return { error: GENERIC_ERROR };
  if (!typedName) return { error: 'Enter your full name.' };

  const signature = parseSignatureSubmission({
    consent: formData.get('esignConsent') as string | null,
    method: formData.get('signatureMethod') as string | null,
    drawnDataUrl: formData.get('signatureDataUrl') as string | null,
  });
  if (!signature.ok) return { error: signature.error };

  // Re-validated here, never trusted from the page render.
  const context = await getBridgeRequestContext();
  const resolved = await resolveTargetToken(token, 'permit_signature', context);
  if ('error' in resolved) return { error: GENERIC_ERROR };

  const result = await signPermitForm(createServiceClient(), {
    orgId: resolved.orgId,
    requestId: resolved.targetId,
    documentId,
    typedName,
    signature: signature.value,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
    tokenId: resolved.tokenId,
    actorLabel: resolved.recipientName ? `${resolved.recipientName} <${resolved.recipientEmailDisplay}>` : resolved.recipientEmailDisplay,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/sign/${token}`);
  return { signed: true };
}
