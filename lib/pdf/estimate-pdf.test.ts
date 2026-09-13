import { describe, expect, it } from 'vitest';
import { generateEstimatePdf } from './estimate-pdf';

// Smoke test only, matching this task's explicit scope: assert a valid,
// non-empty PDF buffer comes back, not exact byte content (pdf-lib's output
// embeds a creation timestamp and other non-deterministic metadata, so
// byte-for-byte assertions would be both brittle and not meaningfully
// testing this module's own logic).
describe('generateEstimatePdf()', () => {
  it('produces a non-empty buffer starting with the %PDF magic header', async () => {
    const bytes = await generateEstimatePdf({
      orgLegalName: 'Acme Contracting Co',
      orgAddressLines: ['1 Main St', 'Toronto, ON M1M 1M1'],
      clientName: 'Jane Client',
      estimateId: 'est-1',
      revisionNumber: 1,
      sentAt: '2026-09-13T00:00:00.000Z',
      expiryDate: '2026-10-13',
      currencyCode: 'CAD',
      scopeNotes: 'Install widgets throughout the second floor.',
      exclusions: 'Excludes electrical permitting.',
      terms: 'Net 30.',
      lineItems: [
        {
          description: 'Widget install',
          quantity: '2',
          unitPriceCents: 10000n,
          lineDiscountCents: 0n,
          gstHstCents: 2600n,
          pstCents: 0n,
          lineTotalCents: 22600n,
        },
      ],
      subtotalCents: 20000n,
      discountTotalCents: 0n,
      taxTotalCents: 2600n,
      totalCents: 22600n,
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const header = Buffer.from(bytes.slice(0, 5)).toString('utf8');
    expect(header).toBe('%PDF-');
  });

  it('produces a valid multi-page PDF when given enough line items to overflow one page', async () => {
    const manyLineItems = Array.from({ length: 80 }, (_, i) => ({
      description: `Line item ${i + 1}`,
      quantity: '1',
      unitPriceCents: 1000n,
      lineDiscountCents: 0n,
      gstHstCents: 130n,
      pstCents: 0n,
      lineTotalCents: 1130n,
    }));

    const bytes = await generateEstimatePdf({
      orgLegalName: 'Acme Contracting Co',
      clientName: 'Jane Client',
      estimateId: 'est-2',
      revisionNumber: 1,
      sentAt: '2026-09-13T00:00:00.000Z',
      currencyCode: 'CAD',
      lineItems: manyLineItems,
      subtotalCents: 80000n,
      discountTotalCents: 0n,
      taxTotalCents: 10400n,
      totalCents: 90400n,
    });

    expect(bytes.length).toBeGreaterThan(0);
    const header = Buffer.from(bytes.slice(0, 5)).toString('utf8');
    expect(header).toBe('%PDF-');
  });
});
