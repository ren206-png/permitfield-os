import { describe, it, expect } from 'vitest';
import { ESIGN_CONSENT_TEXT, MAX_SIGNATURE_BASE64_LENGTH, parseSignatureSubmission, pngBase64ToBytes } from './signature';

// A real 1x1 transparent PNG.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

describe('parseSignatureSubmission()', () => {
  it('requires explicit consent', () => {
    for (const consent of [null, '', 'no', 'on', 'true']) {
      const result = parseSignatureSubmission({ consent, method: 'typed', drawnDataUrl: null });
      expect(result.ok, String(consent)).toBe(false);
    }
  });

  it('accepts a typed signature and records the consent wording', () => {
    expect(parseSignatureSubmission({ consent: 'yes', method: 'typed', drawnDataUrl: TINY_PNG_DATA_URL })).toEqual({
      ok: true,
      value: { consentText: ESIGN_CONSENT_TEXT, method: 'typed', pngBase64: null },
    });
  });

  it('accepts a drawn PNG signature and strips the data URL prefix', () => {
    expect(parseSignatureSubmission({ consent: 'yes', method: 'drawn', drawnDataUrl: TINY_PNG_DATA_URL })).toEqual({
      ok: true,
      value: { consentText: ESIGN_CONSENT_TEXT, method: 'drawn', pngBase64: TINY_PNG_BASE64 },
    });
  });

  it('rejects an unknown method', () => {
    expect(parseSignatureSubmission({ consent: 'yes', method: 'stamp', drawnDataUrl: null }).ok).toBe(false);
    expect(parseSignatureSubmission({ consent: 'yes', method: null, drawnDataUrl: null }).ok).toBe(false);
  });

  it('rejects drawn signatures that are missing, not PNG, malformed, or too large', () => {
    const bad = [
      null,
      '',
      'data:image/png;base64,',
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      'data:image/png;base64,R0lGODlhAQABAAAAACw=',
      `data:image/png;base64,${TINY_PNG_BASE64}<script>`,
      `data:image/png;base64,iVBORw0KGgo${'A'.repeat(MAX_SIGNATURE_BASE64_LENGTH)}`,
    ];
    for (const drawnDataUrl of bad) {
      expect(parseSignatureSubmission({ consent: 'yes', method: 'drawn', drawnDataUrl }).ok, String(drawnDataUrl).slice(0, 40)).toBe(false);
    }
  });
});

describe('pngBase64ToBytes()', () => {
  it('decodes to bytes beginning with the PNG file signature', () => {
    const bytes = pngBase64ToBytes(TINY_PNG_BASE64);
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
