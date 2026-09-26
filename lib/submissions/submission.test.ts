import { describe, it, expect } from 'vitest';
import { resolveSubmissionRecipient } from './recipient';
import { buildSubmissionEmail, safeAttachmentFilename } from './email';
import { formatFromHeader } from '@/lib/email/send';

describe('resolveSubmissionRecipient()', () => {
  const authorityEmail = 'BuildingApplications@richmond.ca';

  it('emails the authority only in production with no override', () => {
    expect(resolveSubmissionRecipient({ authorityEmail, vercelEnv: 'production', overrideEmail: undefined })).toEqual({
      ok: true,
      to: authorityEmail,
      overridden: false,
    });
  });

  it('never emails a real authority outside production', () => {
    for (const vercelEnv of [undefined, 'preview', 'development']) {
      const result = resolveSubmissionRecipient({ authorityEmail, vercelEnv, overrideEmail: undefined });
      expect(result.ok, String(vercelEnv)).toBe(false);
    }
    expect(resolveSubmissionRecipient({ authorityEmail, vercelEnv: 'preview', overrideEmail: '   ' }).ok).toBe(false);
  });

  it('sends to the override in any environment, including production', () => {
    for (const vercelEnv of [undefined, 'preview', 'production']) {
      expect(resolveSubmissionRecipient({ authorityEmail, vercelEnv, overrideEmail: 'me@example.com' })).toEqual({
        ok: true,
        to: 'me@example.com',
        overridden: true,
      });
    }
  });

  it('refuses when production has no verified address', () => {
    expect(resolveSubmissionRecipient({ authorityEmail: null, vercelEnv: 'production', overrideEmail: undefined }).ok).toBe(false);
  });
});

describe('buildSubmissionEmail()', () => {
  const base = {
    authorityName: 'City of Richmond - Building Approvals',
    orgName: 'Acme Electric Inc.',
    projectAddress: '123 Main St, Richmond, BC',
    permitTypeTitle: 'Commercial Tenant Improvement',
    contractorCompanyName: 'Acme Electric',
    contactEmail: 'office@acme.example',
    documentLinks: [{ name: 'Site plan.pdf', url: 'https://storage.example/s/abc?token=1' }],
    linksExpireAt: new Date('2026-10-26T00:00:00Z'),
  };

  it('uses Richmond’s "<Property Address>, <Building Permit Type>" subject format', () => {
    expect(buildSubmissionEmail(base).subject).toBe('123 Main St, Richmond, BC, Commercial Tenant Improvement');
  });

  it('names the attachment after the property address', () => {
    expect(buildSubmissionEmail(base).attachmentFilename).toBe('123 Main St, Richmond, BC Application Form.pdf');
  });

  it('lists document links with their expiry, and says so when there are none', () => {
    const withDocs = buildSubmissionEmail(base);
    expect(withDocs.text).toContain('valid until 2026-10-26');
    expect(withDocs.text).toContain('- Site plan.pdf: https://storage.example/s/abc?token=1');
    const none = buildSubmissionEmail({ ...base, documentLinks: [] });
    expect(none.text).toContain('No supporting drawings or documents');
  });

  it('escapes user-controlled text in the HTML body', () => {
    const html = buildSubmissionEmail({
      ...base,
      projectAddress: '1 <script>alert(1)</script> St',
      documentLinks: [{ name: '"><img src=x>', url: 'https://x.example/?a=1&b=2' }],
    }).html;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a=1&amp;b=2');
  });

  it('keeps line breaks out of the subject', () => {
    const subject = buildSubmissionEmail({ ...base, projectAddress: '1 Main St\r\nBcc: evil@example.com' }).subject;
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

describe('safeAttachmentFilename()', () => {
  it('strips path separators and forbidden characters', () => {
    expect(safeAttachmentFilename('../a/b:c*d?"e"<f>|g')).toBe('.. a b c d e f g.pdf');
    expect(safeAttachmentFilename('   ')).toBe('Application Form.pdf');
  });
});

describe('formatFromHeader()', () => {
  it('adds a display name to a bare or already-named address', () => {
    expect(formatFromHeader('notifications@permitfieldos.com', 'Acme via PermitField')).toBe(
      '"Acme via PermitField" <notifications@permitfieldos.com>'
    );
    expect(formatFromHeader('PermitField <notifications@permitfieldos.com>', 'Acme')).toBe('"Acme" <notifications@permitfieldos.com>');
    expect(formatFromHeader('notifications@permitfieldos.com')).toBe('notifications@permitfieldos.com');
  });

  it('cannot be used to inject headers or break the quoted name', () => {
    expect(formatFromHeader('n@p.com', 'Evil"\r\nBcc: x@y.com <z>')).toBe('"EvilBcc: x@y.com z" <n@p.com>');
  });
});
