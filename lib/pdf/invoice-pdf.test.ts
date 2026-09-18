import { describe, expect, it } from 'vitest';
import { generateInvoicePdf } from './invoice-pdf';

// Smoke test only -- see estimate-pdf.test.ts's header comment for why this
// asserts a valid, non-empty PDF rather than exact byte content.
describe('generateInvoicePdf()', () => {
  it('produces a non-empty buffer starting with the %PDF magic header for an issued invoice', async () => {
    const bytes = await generateInvoicePdf({
      orgLegalName: 'Acme Contracting Co',
      orgAddressLines: ['1 Main St', 'Toronto, ON M1M 1M1'],
      clientName: 'Jane Client',
      invoiceId: 'inv-1',
      invoiceNumber: 1n,
      status: 'issued',
      issuedAt: '2026-09-13T00:00:00.000Z',
      dueDate: '2026-10-13',
      currencyCode: 'CAD',
      scopeNotes: 'Install widgets throughout the second floor.',
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
      documentHash: 'a'.repeat(64),
    });

    expect(bytes.length).toBeGreaterThan(0);
    const header = Buffer.from(bytes.slice(0, 5)).toString('utf8');
    expect(header).toBe('%PDF-');
  });

  it('still produces a valid, non-empty PDF for a voided invoice (financial history is rendered, not blanked out)', async () => {
    const bytes = await generateInvoicePdf({
      orgLegalName: 'Acme Contracting Co',
      clientName: 'Jane Client',
      invoiceId: 'inv-2',
      invoiceNumber: 2n,
      status: 'void',
      issuedAt: '2026-09-13T00:00:00.000Z',
      voidedAt: '2026-09-14T00:00:00.000Z',
      voidReason: 'client requested cancellation',
      currencyCode: 'CAD',
      lineItems: [
        {
          description: 'Widget install',
          quantity: '1',
          unitPriceCents: 10000n,
          lineDiscountCents: 0n,
          gstHstCents: 1300n,
          pstCents: 0n,
          lineTotalCents: 11300n,
        },
      ],
      subtotalCents: 10000n,
      discountTotalCents: 0n,
      taxTotalCents: 1300n,
      totalCents: 11300n,
    });

    expect(bytes.length).toBeGreaterThan(0);
    const header = Buffer.from(bytes.slice(0, 5)).toString('utf8');
    expect(header).toBe('%PDF-');
  });
});
