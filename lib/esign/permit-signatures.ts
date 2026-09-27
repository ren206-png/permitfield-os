import type { SupabaseClient } from '@supabase/supabase-js';
import { issueTargetToken } from '@/lib/bridge/client-portal';
import { sendEmail } from '@/lib/email/send';
import { renderPermitSignatureRequestEmail } from '@/lib/email/templates/permit-signature-request';
import { isPermitEsignEnabled } from '@/lib/flags';
import { provinceTimeZone, stampSignature, type SignatureDateFormat, type SignatureSlot } from '@/lib/pdf/stamp-signature';
import { SITE_URL } from '@/lib/seo';
import { buildStoragePath, computeSha256, GENERATED_BUCKET } from '@/lib/storage/documents';
import { pngBase64ToBytes, type SignatureSubmission } from './signature';

// E-signature, Stage B: asking someone to sign a filled city permit form, and
// recording their signature. The database functions in
// 20260806000073_permit_form_esignatures.sql make every authorization and
// state decision (who may ask, whether the authority accepts e-signatures,
// whether the form is still the one the signer opened); this module does the
// work around them -- the link, the email, and stamping the PDF.

type Client = SupabaseClient;

export type SignerRole = 'applicant' | 'owner';

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// The functions raise 'code: message'; the message after the code is written
// for the person who triggered it.
function rpcErrorMessage(message: string, fallback: string): string {
  const match = /^[a-z_]+: (.+)$/.exec(message);
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) + '.' : fallback;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface RequestSignatureContext {
  orgId: string;
  orgName: string;
  userId: string;
  userEmail: string | null;
}

export interface RequestSignatureInput {
  applicationId: string;
  filingId: string;
  signerRole: SignerRole;
  signerName: string;
  signerEmail: string;
}

export type RequestSignatureResult =
  | { ok: true; signUrl: string; emailed: boolean; emailError: string | null }
  | { ok: false; error: string };

export async function requestPermitSignature(
  supabase: Client,
  ctx: RequestSignatureContext,
  input: RequestSignatureInput
): Promise<RequestSignatureResult> {
  if (!isPermitEsignEnabled()) return { ok: false, error: 'Permit form signing is currently off.' };

  const signerName = input.signerName.trim();
  const signerEmail = input.signerEmail.trim();
  if (!signerName || signerName.length > 200) return { ok: false, error: 'Enter the signer’s full name.' };
  if (!EMAIL_PATTERN.test(signerEmail) || signerEmail.length > 320) return { ok: false, error: 'Enter a valid email address for the signer.' };

  const { data: requestId, error: requestError } = await supabase.rpc('request_permit_signature', {
    p_application_id: input.applicationId,
    p_permit_type_filing_id: input.filingId,
    p_signer_role: input.signerRole,
    p_signer_name: signerName,
    p_signer_email: signerEmail,
  });
  if (requestError || typeof requestId !== 'string') {
    return { ok: false, error: rpcErrorMessage(requestError?.message ?? '', 'Could not create the signature request.') };
  }

  const token = await issueTargetToken({
    targetKind: 'permit_signature',
    targetId: requestId,
    orgId: ctx.orgId,
    recipientEmail: signerEmail,
    recipientName: signerName,
    issuedByOrgUserId: ctx.userId,
  });
  if ('error' in token) {
    // No link means no way to sign: withdraw the request rather than leave a
    // pending one nobody can act on.
    await supabase.rpc('cancel_permit_signature_request', { p_request_id: requestId });
    return {
      ok: false,
      error:
        token.error === 'client_portal_disabled'
          ? 'The client link system (PERMITFIELD_FF_CLIENT_PORTAL) is off, so a signing link can’t be created.'
          : 'Creating the signing link failed. Try again.',
    };
  }
  const signUrl = `${SITE_URL}/sign/${token.rawToken}`;

  const { data: details } = await supabase
    .from('permit_applications')
    .select('project_address, permit_types ( title )')
    .eq('id', input.applicationId)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  const { data: filing } = await supabase
    .from('permit_type_filings')
    .select('authorities ( name )')
    .eq('id', input.filingId)
    .maybeSingle();

  const email = renderPermitSignatureRequestEmail({
    recipientEmail: signerEmail,
    recipientName: signerName,
    organizationName: ctx.orgName,
    requesterEmail: ctx.userEmail,
    permitTypeTitle: first(details?.permit_types as { title: string } | { title: string }[] | null)?.title ?? 'permit',
    authorityName: first(filing?.authorities as { name: string } | { name: string }[] | null)?.name ?? 'the authority',
    projectAddress: details?.project_address ?? 'your project',
    signUrl,
    expiresAt: token.expiresAt,
  });
  const sent = await sendEmail(email);

  return { ok: true, signUrl, emailed: sent.success, emailError: sent.success ? null : sent.error };
}

export async function cancelPermitSignatureRequest(supabase: Client, requestId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('cancel_permit_signature_request', { p_request_id: requestId });
  return error ? { ok: false, error: rpcErrorMessage(error.message, 'Could not cancel the request.') } : { ok: true };
}

// --- Signer side (service role, after the signing link was validated) -----

export interface SigningView {
  requestId: string;
  status: 'pending' | 'signed' | 'cancelled';
  signerName: string;
  signerRole: SignerRole;
  signedAt: string | null;
  organizationName: string;
  projectAddress: string;
  permitTypeTitle: string;
  authorityName: string;
  /** The form the signer is shown and will sign: the latest one generated for the filing. */
  document: { id: string; storagePath: string } | null;
  applicationOpen: boolean;
}

// Every query is scoped by the orgId/requestId the validated token returned
// (lib/supabase/service-client.ts, Exception 2).
export async function loadSigningView(service: Client, orgId: string, requestId: string): Promise<SigningView | null> {
  const { data: request } = await service
    .from('permit_signature_requests')
    .select('id, status, signer_name, signer_role, signed_at, application_id, permit_type_filing_id')
    .eq('id', requestId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!request) return null;

  const [{ data: application }, { data: filing }, { data: organization }, { data: latest }] = await Promise.all([
    service
      .from('permit_applications')
      .select('status, project_address, permit_types ( title )')
      .eq('id', request.application_id)
      .eq('org_id', orgId)
      .maybeSingle(),
    service.from('permit_type_filings').select('authorities ( name )').eq('id', request.permit_type_filing_id).maybeSingle(),
    service.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    service
      .from('generated_documents')
      .select('id, storage_path')
      .eq('application_id', request.application_id)
      .eq('permit_type_filing_id', request.permit_type_filing_id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!application) return null;

  return {
    requestId: request.id,
    status: request.status,
    signerName: request.signer_name,
    signerRole: request.signer_role,
    signedAt: request.signed_at,
    organizationName: organization?.name ?? 'Your contractor',
    projectAddress: application.project_address,
    permitTypeTitle: first(application.permit_types as { title: string } | { title: string }[] | null)?.title ?? 'Permit application',
    authorityName: first(filing?.authorities as { name: string } | { name: string }[] | null)?.name ?? 'the authority',
    document: latest ? { id: latest.id, storagePath: latest.storage_path } : null,
    applicationOpen: application.status === 'documents_generated',
  };
}

export interface SignPermitFormInput {
  orgId: string;
  requestId: string;
  /** The document id the signer's page was rendered with -- must still be the latest. */
  documentId: string;
  typedName: string;
  signature: SignatureSubmission;
  ip: string | null;
  userAgent: string | null;
  tokenId: string;
  actorLabel: string;
  now?: Date;
}

export type SignPermitFormResult = { ok: true; signedDocumentId: string } | { ok: false; error: string; stale?: boolean };

const STALE_MESSAGE = 'This form was updated after you opened it. Refresh the page to review the latest version before signing.';

interface SlotRow {
  page: number;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  signature_pdf_field_name: string | null;
  name_pdf_field_name: string | null;
  name_x: number | string | null;
  name_y: number | string | null;
  date_pdf_field_name: string | null;
  date_x: number | string | null;
  date_y: number | string | null;
  date_format: SignatureDateFormat;
}

function toSlot(row: SlotRow): SignatureSlot {
  const num = (value: number | string | null) => (value === null ? null : Number(value));
  return {
    page: row.page,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    signaturePdfFieldName: row.signature_pdf_field_name,
    namePdfFieldName: row.name_pdf_field_name,
    nameX: num(row.name_x),
    nameY: num(row.name_y),
    datePdfFieldName: row.date_pdf_field_name,
    dateX: num(row.date_x),
    dateY: num(row.date_y),
    dateFormat: row.date_format,
  };
}

export async function signPermitForm(service: Client, input: SignPermitFormInput): Promise<SignPermitFormResult> {
  const typedName = input.typedName.trim();
  if (!typedName || typedName.length > 200) return { ok: false, error: 'Enter your full name.' };

  const { data: request } = await service
    .from('permit_signature_requests')
    .select('id, status, signer_role, application_id, permit_type_filing_id')
    .eq('id', input.requestId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (!request) return { ok: false, error: 'This signing link is no longer available.' };
  if (request.status !== 'pending') return { ok: false, error: 'This form has already been signed, or the request was withdrawn.' };

  const [{ data: latest }, { data: slotRow }, { data: application }] = await Promise.all([
    service
      .from('generated_documents')
      .select('id, storage_path')
      .eq('application_id', request.application_id)
      .eq('permit_type_filing_id', request.permit_type_filing_id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from('permit_form_signature_slots')
      .select(
        'page, x, y, width, height, signature_pdf_field_name, name_pdf_field_name, name_x, name_y, date_pdf_field_name, date_x, date_y, date_format'
      )
      .eq('permit_type_filing_id', request.permit_type_filing_id)
      .eq('signer_role', request.signer_role)
      .maybeSingle(),
    service
      .from('permit_applications')
      .select('permit_types ( jurisdictions ( province_code ) )')
      .eq('id', request.application_id)
      .eq('org_id', input.orgId)
      .maybeSingle(),
  ]);
  if (!latest || latest.id !== input.documentId) return { ok: false, error: STALE_MESSAGE, stale: true };
  if (!slotRow) return { ok: false, error: 'This form has no place for your signature. Contact the sender.' };

  const permitType = first(application?.permit_types as { jurisdictions: unknown } | { jurisdictions: unknown }[] | null);
  const provinceCode = first(permitType?.jurisdictions as { province_code: string } | { province_code: string }[] | null)?.province_code;

  const { data: blob, error: downloadError } = await service.storage.from(GENERATED_BUCKET).download(latest.storage_path);
  if (downloadError || !blob) return { ok: false, error: 'The form could not be loaded. Try again in a moment.' };
  const sourceBytes = Buffer.from(await blob.arrayBuffer());
  const sourceSha256 = computeSha256(sourceBytes);

  const signedBytes = await stampSignature({
    pdfBytes: new Uint8Array(sourceBytes),
    slot: toSlot(slotRow as SlotRow),
    method: input.signature.method,
    pngBytes: input.signature.pngBase64 ? pngBase64ToBytes(input.signature.pngBase64) : null,
    typedName,
    signedAt: input.now ?? new Date(),
    timeZone: provinceTimeZone(provinceCode),
    reference: request.id,
  });
  const signedBuffer = Buffer.from(signedBytes);
  const signedFilename = `${request.permit_type_filing_id}-signed.pdf`;
  const signedPath = buildStoragePath(input.orgId, request.application_id, computeSha256(signedBuffer), signedFilename);

  // Content-addressed path, so a retry re-uploads identical bytes; if the
  // record step below then fails, the orphaned object is inert (nothing
  // points at it).
  const { error: uploadError } = await service.storage
    .from(GENERATED_BUCKET)
    .upload(signedPath, signedBuffer, { contentType: 'application/pdf', upsert: true });
  if (uploadError) return { ok: false, error: 'Saving the signed form failed. Try again in a moment.' };

  const { data: signedDocumentId, error: recordError } = await service.rpc('record_permit_signature', {
    p_request_id: request.id,
    p_org_id: input.orgId,
    p_source_document_id: latest.id,
    p_source_document_sha256: sourceSha256,
    p_signed_storage_path: signedPath,
    p_signed_filename: signedFilename,
    p_typed_name: typedName,
    p_esign_consent_text: input.signature.consentText,
    p_signature_method: input.signature.method,
    p_signature_png_base64: input.signature.pngBase64,
    p_ip: input.ip,
    p_user_agent: input.userAgent,
    p_external_actor_id: input.tokenId,
    p_external_actor_label: input.actorLabel,
  });
  if (recordError || typeof signedDocumentId !== 'string') {
    const message = recordError?.message ?? '';
    if (message.includes('stale_document')) return { ok: false, error: STALE_MESSAGE, stale: true };
    if (message.includes('not_pending')) return { ok: false, error: 'This form has already been signed, or the request was withdrawn.' };
    if (message.includes('not_ready')) return { ok: false, error: 'This application is no longer open for signing. Contact the sender.' };
    console.error(`signPermitForm: record_permit_signature failed for request ${request.id}: ${message}`);
    return { ok: false, error: 'Recording your signature failed. Try again in a moment.' };
  }

  return { ok: true, signedDocumentId };
}
