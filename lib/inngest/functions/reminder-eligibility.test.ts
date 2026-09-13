import { describe, it, expect } from 'vitest';
import {
  evaluateEstimateReminderEligibility,
  evaluateInvoiceReminderEligibility,
  sumRecordedAllocationCents,
  type EstimateStatus,
} from './reminder-eligibility';

describe('evaluateEstimateReminderEligibility', () => {
  it('is eligible only while status is "sent"', () => {
    expect(evaluateEstimateReminderEligibility('sent').eligible).toBe(true);
  });

  it.each<EstimateStatus>(['draft', 'accepted', 'declined', 'expired', 'void'])(
    'is not eligible when status is "%s"',
    (status) => {
      const result = evaluateEstimateReminderEligibility(status);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain(status);
    }
  );
});

describe('sumRecordedAllocationCents', () => {
  it('sums only allocations whose payment is still "recorded"', () => {
    const total = sumRecordedAllocationCents([
      { amountCents: 1000n, paymentStatus: 'recorded' },
      { amountCents: 500n, paymentStatus: 'reversed' },
      { amountCents: 250n, paymentStatus: 'recorded' },
    ]);
    expect(total).toBe(1250n);
  });

  it('returns 0n for an empty list', () => {
    expect(sumRecordedAllocationCents([])).toBe(0n);
  });

  it('returns 0n when every allocation belongs to a reversed payment', () => {
    expect(sumRecordedAllocationCents([{ amountCents: 999n, paymentStatus: 'reversed' }])).toBe(0n);
  });
});

describe('evaluateInvoiceReminderEligibility', () => {
  it('is eligible when issued with an outstanding balance', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'issued',
      paidCents: 0n,
      issuedTotalCents: 10000n,
    });
    expect(result.eligible).toBe(true);
  });

  it('is eligible when partially paid but a balance remains', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'issued',
      paidCents: 4000n,
      issuedTotalCents: 10000n,
    });
    expect(result.eligible).toBe(true);
  });

  it('is not eligible once fully paid', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'issued',
      paidCents: 10000n,
      issuedTotalCents: 10000n,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('fully paid');
  });

  it('is not eligible when overpaid (paid exceeds issued total)', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'issued',
      paidCents: 10500n,
      issuedTotalCents: 10000n,
    });
    expect(result.eligible).toBe(false);
  });

  it('is not eligible when the invoice has been voided', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'void',
      paidCents: 0n,
      issuedTotalCents: 10000n,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('void');
  });

  it('is not eligible while still a draft', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'draft',
      paidCents: 0n,
      issuedTotalCents: null,
    });
    expect(result.eligible).toBe(false);
  });

  it('is not eligible when issuedTotalCents is null even if status is issued (defensive case)', () => {
    const result = evaluateInvoiceReminderEligibility({
      status: 'issued',
      paidCents: 0n,
      issuedTotalCents: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('outstanding balance');
  });
});
