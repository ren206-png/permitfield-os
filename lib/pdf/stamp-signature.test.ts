import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { formatSignatureDate, provinceTimeZone, stampSignature, type SignatureSlot } from './stamp-signature';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FORMS = path.join(ROOT, 'docs-reference-forms');
// Every migration that seeds signature slots.
const MIGRATION = [
  '20260806000073_permit_form_esignatures.sql',
  '20260806000077_ottawa_commercial_tenant_improvement.sql',
  '20260806000078_hamilton_commercial_tenant_improvement.sql',
  '20260806000079_edmonton_commercial_tenant_improvement.sql',
  '20260806000083_toronto_commercial_tenant_improvement.sql',
]
  .map((f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'))
  .join('\n');

// Template path in the catalog -> committed reference PDF (same pairing as
// scripts/seed-storage-templates.ts).
const FILING_FORMS: Record<string, string> = {
  '00000000-0000-0000-0004-000000000001': 'ontario-permit-to-construct-or-demolish-2026.pdf',
  '00000000-0000-0000-0004-000000000002': 'esa-icia-low-voltage.pdf',
  '00000000-0000-0000-0004-000000000004': 'surrey-building-permit-application.pdf',
  '00000000-0000-0000-0004-000000000005': 'vancouver-dev-build-app-form.pdf',
  '00000000-0000-0000-0004-000000000006': 'richmond-pl43-addition-alterations.pdf',
  '00000000-0000-0000-0004-000000000007': 'coquitlam-permit-application-form.pdf',
  '00000000-0000-0000-0004-000000000008': 'port-coquitlam-ti-application.pdf',
  '00000000-0000-0000-0004-000000000009': 'maple-ridge-tenant-landlord-improvement-application.pdf',
  '00000000-0000-0000-0004-00000000000a': 'ontario-permit-to-construct-or-demolish-2026.pdf',
  '00000000-0000-0000-0004-00000000000b': 'ontario-permit-to-construct-or-demolish-2026.pdf',
  '00000000-0000-0000-0004-00000000000c': 'edmonton-commercial-interior-alterations-short-form.pdf',
  '00000000-0000-0000-0004-00000000000d': 'ontario-permit-to-construct-or-demolish-2026.pdf',
};

const VANCOUVER_SLOT: SignatureSlot = {
  page: 3,
  x: 38,
  y: 72,
  width: 376,
  height: 17,
  signaturePdfFieldName: 'Applicant signature typed electronic inserted electronic or written signature',
  namePdfFieldName: null,
  nameX: null,
  nameY: null,
  datePdfFieldName: 'Date',
  dateX: null,
  dateY: null,
  dateFormat: 'yyyy-mm-dd',
};

function form(file: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FORMS, file)));
}

// Smallest valid PNG: 1x1, black, opaque.
const PNG_1X1 = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
);

describe('formatSignatureDate()', () => {
  // 05:00 UTC on the 27th is still the evening of the 26th in Vancouver.
  const instant = new Date('2026-09-27T05:00:00Z');

  it('dates in the jurisdiction’s zone, not UTC', () => {
    expect(formatSignatureDate(instant, 'America/Vancouver', 'yyyy-mm-dd')).toBe('2026-09-26');
    expect(formatSignatureDate(instant, 'America/Toronto', 'yyyy-mm-dd')).toBe('2026-09-27');
  });

  it('writes the form’s own format', () => {
    expect(formatSignatureDate(instant, 'America/Vancouver', 'mm/dd/yyyy')).toBe('09/26/2026');
    expect(formatSignatureDate(instant, 'America/Vancouver', 'dd-mm-yyyy')).toBe('26-09-2026');
  });

  it('maps provinces to zones, defaulting to Eastern', () => {
    expect(provinceTimeZone('bc')).toBe('America/Vancouver');
    expect(provinceTimeZone('AB')).toBe('America/Edmonton');
    expect(provinceTimeZone(null)).toBe('America/Toronto');
  });
});

describe('stampSignature()', () => {
  const base = { typedName: 'Jordan Rivera', signedAt: new Date('2026-09-26T18:00:00Z'), timeZone: 'America/Vancouver', reference: 'req-123' };

  it('replaces the form’s signature field, fills the date, and tags the file', async () => {
    const out = await stampSignature({ ...base, pdfBytes: form('vancouver-dev-build-app-form.pdf'), slot: VANCOUVER_SLOT, method: 'drawn', pngBytes: PNG_1X1 });
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName());
    expect(names).not.toContain(VANCOUVER_SLOT.signaturePdfFieldName);
    expect(doc.getForm().getTextField('Date').getText()).toBe('2026-09-26');
    expect(doc.getKeywords()).toContain('permitfield-esignature:req-123');
  });

  it('stamps a typed signature and overlay name/date on a form without fields (ESA)', async () => {
    const slot: SignatureSlot = {
      page: 1, x: 368, y: 658.5, width: 94, height: 10,
      signaturePdfFieldName: null, namePdfFieldName: null, nameX: 261, nameY: 660.1,
      datePdfFieldName: null, dateX: 137.4, dateY: 681.7, dateFormat: 'yyyy-mm-dd',
    };
    // Includes a character outside WinAnsi, which must degrade to '?' rather than throw.
    const out = await stampSignature({ ...base, typedName: 'Zoë Ångström 李', pdfBytes: form('esa-icia-low-voltage.pdf'), slot, method: 'typed', pngBytes: null });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getKeywords()).toContain('permitfield-esignature:req-123');
  });

  it('refuses a slot whose field is missing from the form', async () => {
    await expect(
      stampSignature({ ...base, pdfBytes: form('vancouver-dev-build-app-form.pdf'), slot: { ...VANCOUVER_SLOT, signaturePdfFieldName: 'No Such Field' }, method: 'typed', pngBytes: null })
    ).rejects.toThrow(/not found/);
  });

  it('refuses a drawn signature without its image', async () => {
    await expect(
      stampSignature({ ...base, pdfBytes: form('vancouver-dev-build-app-form.pdf'), slot: VANCOUVER_SLOT, method: 'drawn', pngBytes: null })
    ).rejects.toThrow(/image/);
  });
});

describe('seeded signature slots', () => {
  const DATE_FORMATS = ['yyyy-mm-dd', 'mm/dd/yyyy', 'dd-mm-yyyy'];
  // Each seeded slot row: its filing, page, and every quoted value after the
  // coordinates -- the signature/name/date field names plus the date format.
  const rows = [...MIGRATION.matchAll(/\('(00000000-0000-0000-0004-0000000000[0-9a-f]{2})', 'applicant', (\d+),[^\n]*\n\s+(.+?)\),?\n/g)].map((m) => ({
    filing: m[1],
    page: Number(m[2]),
    fieldNames: [...m[3].matchAll(/'([^']+)'/g)].map((f) => f[1]).filter((v) => !DATE_FORMATS.includes(v)),
  }));

  it('seeds one applicant slot per mapped form', () => {
    expect(rows.map((r) => r.filing).sort()).toEqual(Object.keys(FILING_FORMS).sort());
    expect(rows.find((r) => r.filing.endsWith('01'))?.fieldNames).toEqual([
      'Signature of applicant',
      'Name of Applicant for Declaration',
      'Date Applicant Signed Main Form',
    ]);
  });

  it.each(Object.entries(FILING_FORMS))('filing %s: every referenced field exists on %s', async (filing, file) => {
    const row = rows.find((r) => r.filing === filing)!;
    const doc = await PDFDocument.load(form(file));
    const names = new Set(doc.getForm().getFields().map((f) => f.getName()));
    for (const name of row.fieldNames) {
      expect(names.has(name), `${file} has no field "${name}"`).toBe(true);
    }
    expect(row.page).toBeLessThanOrEqual(doc.getPageCount());
  });
});
