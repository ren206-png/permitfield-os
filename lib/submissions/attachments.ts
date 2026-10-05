import { safeAttachmentFilename } from './email';

// Attachments for an authority that takes documents only as PDF attachments
// in the submission email (authorities.submission_attachments_only -- Surrey:
// "Each required document must be a separate PDF attachment ... jpg files, zip
// files, downloadable links ... are not accepted"). Pure, so the checks are
// unit-tested.

// Resend caps an email at 40 MB including attachments after Base64 encoding,
// which inflates by a third: 28 MB of raw files encodes to ~37 MB, leaving
// room for the body.
export const MAX_EMAIL_ATTACHMENT_BYTES = 28 * 1024 * 1024;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: 'application/pdf';
}

export type AttachmentPlan = { ok: true; attachments: EmailAttachment[]; documentNames: string[] } | { ok: false; error: string };

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function planEmailAttachments(input: {
  authorityName: string;
  form: { filename: string; bytes: Buffer };
  documents: { name: string; bytes: Buffer }[];
}): AttachmentPlan {
  const notPdf = input.documents.filter((doc) => !isPdf(doc.bytes)).map((doc) => doc.name);
  if (notPdf.length > 0) {
    return {
      ok: false,
      error: `${input.authorityName} only accepts PDF attachments. Replace or remove: ${notPdf.join(', ')}.`,
    };
  }

  const total = input.form.bytes.byteLength + input.documents.reduce((sum, doc) => sum + doc.bytes.byteLength, 0);
  if (total > MAX_EMAIL_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `The form and documents total ${megabytes(total)}, more than the ${megabytes(MAX_EMAIL_ATTACHMENT_BYTES)} one email can carry. Ask ${input.authorityName} how to send a larger package.`,
    };
  }

  const used = new Set([input.form.filename.toLowerCase()]);
  const attachments: EmailAttachment[] = [{ filename: input.form.filename, content: input.form.bytes, contentType: 'application/pdf' }];
  const documentNames: string[] = [];
  for (const doc of input.documents) {
    const base = doc.name.replace(/\.pdf$/i, '');
    let filename = safeAttachmentFilename(base);
    for (let n = 2; used.has(filename.toLowerCase()); n++) {
      filename = safeAttachmentFilename(`${base} (${n})`);
    }
    used.add(filename.toLowerCase());
    attachments.push({ filename, content: doc.bytes, contentType: 'application/pdf' });
    documentNames.push(filename);
  }
  return { ok: true, attachments, documentNames };
}
