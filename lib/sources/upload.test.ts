import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanFileName, detectContentType, MAX_UPLOAD_BYTES, prepareUploadedSource } from './upload';

describe('uploaded source copies', () => {
  it('keeps only a safe base name', () => {
    expect(cleanFileName('../../etc/fees.pdf')).toBe('fees.pdf');
    expect(cleanFileName('C:\\Users\\ren\\fees 2026.pdf')).toBe('fees 2026.pdf');
    expect(cleanFileName('a\u0000b\nc.pdf')).toBe('abc.pdf');
    expect(cleanFileName('')).toBe('upload');
    expect(cleanFileName(`${'x'.repeat(300)}.pdf`)).toHaveLength(255);
  });

  it('decides the type from the PDF signature first, then the declared type, then the extension', () => {
    expect(detectContentType(Buffer.from('%PDF-1.7 ...'), 'application/octet-stream', 'fees.bin')).toBe('application/pdf');
    expect(detectContentType(Buffer.from('<html></html>'), 'text/html; charset=utf-8', 'page')).toBe('text/html');
    expect(detectContentType(Buffer.from('plain'), '', 'notes.txt')).toBe('text/plain');
    expect(detectContentType(Buffer.from('PK\u0003\u0004'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'fees.docx')).toBeNull();
  });

  it('stages HTML through the same loader and capture builder as a fetch', async () => {
    const html = '<html><head><script>alert(1)</script></head><body><h1>Building permit fees</h1><p>First $5,000: $217.00</p></body></html>';
    const result = await prepareUploadedSource(Buffer.from(html), 'text/html', 'fees.html');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe('text/html');
    expect(result.capture.loader).toBe('html');
    expect(result.capture.text).toContain('First $5,000: $217.00');
    expect(result.capture.text).not.toContain('alert(1)');
    expect(result.capture.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stages a real PDF by its text layer, whatever type the browser declared', async () => {
    const pdf = readFileSync('docs-reference-forms/calgary-commercial-permit.pdf');
    const result = await prepareUploadedSource(pdf, 'application/octet-stream', 'calgary-commercial-permit.pdf');
    expect(result).toMatchObject({ ok: true, contentType: 'application/pdf', fileName: 'calgary-commercial-permit.pdf' });
    if (result.ok) expect(result.capture.loader).toBe('pdf');
  });

  it('refuses empty, oversized, unsupported and mislabelled files', async () => {
    expect(await prepareUploadedSource(Buffer.alloc(0), 'text/plain', 'a.txt')).toMatchObject({ ok: false, status: 400 });
    expect(await prepareUploadedSource(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61), 'text/plain', 'a.txt')).toMatchObject({ ok: false, status: 413 });
    expect(await prepareUploadedSource(Buffer.from('PK\u0003\u0004'), 'application/zip', 'a.zip')).toMatchObject({ ok: false, status: 415 });
    // Declared HTML, but binary: the loader's signature check refuses it.
    expect(await prepareUploadedSource(Buffer.from([0x3c, 0x00, 0x01, 0x02]), 'text/html', 'a.html')).toMatchObject({ ok: false, status: 422 });
  });
});
