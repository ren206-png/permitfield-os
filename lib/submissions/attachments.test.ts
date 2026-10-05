import { describe, expect, it } from 'vitest';
import { MAX_EMAIL_ATTACHMENT_BYTES, planEmailAttachments } from './attachments';

const pdf = (body = 'x') => Buffer.from(`%PDF-1.7\n${body}`);
const form = { filename: '1 Main St Application Form.pdf', bytes: pdf('form') };

describe('planEmailAttachments()', () => {
  it('attaches the form first, then each document as its own PDF with a unique, safe name', () => {
    const plan = planEmailAttachments({
      authorityName: 'City of Surrey',
      form,
      documents: [
        { name: 'Site plan.pdf', bytes: pdf() },
        { name: 'site plan.PDF', bytes: pdf() },
        { name: 'a/b:c', bytes: pdf() },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.attachments.map((a) => a.filename)).toEqual([form.filename, 'Site plan.pdf', 'site plan (2).pdf', 'a b c.pdf']);
    expect(plan.documentNames).toEqual(['Site plan.pdf', 'site plan (2).pdf', 'a b c.pdf']);
    expect(plan.attachments.every((a) => a.contentType === 'application/pdf')).toBe(true);
  });

  it('refuses documents that are not PDFs, naming them', () => {
    const plan = planEmailAttachments({
      authorityName: 'City of Surrey',
      form,
      documents: [
        { name: 'photo.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
        { name: 'renamed.pdf', bytes: Buffer.from('PK\u0003\u0004') },
        { name: 'ok.pdf', bytes: pdf() },
      ],
    });
    expect(plan).toEqual({ ok: false, error: 'City of Surrey only accepts PDF attachments. Replace or remove: photo.jpg, renamed.pdf.' });
  });

  it('refuses a package larger than one email can carry', () => {
    const plan = planEmailAttachments({
      authorityName: 'City of Surrey',
      form,
      documents: [{ name: 'drawings.pdf', bytes: Buffer.concat([pdf(), Buffer.alloc(MAX_EMAIL_ATTACHMENT_BYTES)]) }],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/more than the 28\.0 MB one email can carry\. Ask City of Surrey/);
  });

  it('sends just the form when there are no documents', () => {
    const plan = planEmailAttachments({ authorityName: 'City of Surrey', form, documents: [] });
    expect(plan.ok && plan.attachments.length === 1 && plan.documentNames.length === 0).toBe(true);
  });
});
