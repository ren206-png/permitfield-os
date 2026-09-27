// E-signature, Stage A. The exact consent wording is stored verbatim on each
// acceptance row (esign_consent_text), so changing this string only affects
// signatures captured after the change -- existing records keep what the
// signer actually agreed to.
export const ESIGN_CONSENT_TEXT =
  'I agree to sign this document electronically. I understand my electronic signature is legally binding, the same as a handwritten signature, and that I can request a paper copy from the sender.';

export type SignatureMethod = 'typed' | 'drawn';

// Mirrors assert_valid_esignature() in
// supabase/migrations/20260806000069_esignature_consent_and_signature.sql.
export const MAX_SIGNATURE_BASE64_LENGTH = 400_000;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_BASE64_SIGNATURE = 'iVBORw0KGgo';
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface SignatureSubmission {
  consentText: string;
  method: SignatureMethod;
  pngBase64: string | null;
}

export type ParseSignatureResult = { ok: true; value: SignatureSubmission } | { ok: false; error: string };

export function parseSignatureSubmission(input: {
  consent: string | null;
  method: string | null;
  drawnDataUrl: string | null;
}): ParseSignatureResult {
  if (input.consent !== 'yes') {
    return { ok: false, error: 'Tick the box to agree to sign electronically.' };
  }

  if (input.method === 'typed') {
    return { ok: true, value: { consentText: ESIGN_CONSENT_TEXT, method: 'typed', pngBase64: null } };
  }

  if (input.method !== 'drawn') {
    return { ok: false, error: 'Choose how you want to sign.' };
  }

  const dataUrl = input.drawnDataUrl ?? '';
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, error: 'Draw your signature in the box before signing.' };
  }
  const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (
    base64.length === 0 ||
    base64.length > MAX_SIGNATURE_BASE64_LENGTH ||
    !BASE64_PATTERN.test(base64) ||
    !base64.startsWith(PNG_BASE64_SIGNATURE)
  ) {
    return { ok: false, error: 'That signature could not be read. Clear it and draw it again.' };
  }

  return { ok: true, value: { consentText: ESIGN_CONSENT_TEXT, method: 'drawn', pngBase64: base64 } };
}

export function pngBase64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}
