import { describe, it, expect } from 'vitest';
import { planEstimateReminders, planInvoiceReminders } from './quote-reminder-schedule';

const now = new Date('2026-09-27T12:00:00Z');

describe('planEstimateReminders()', () => {
  it('reminds 3 days before expiry at 15:00 UTC', () => {
    expect(planEstimateReminders('2026-10-15', now)).toEqual([{ kind: 'estimate_expiring', sendAfter: '2026-10-12T15:00:00.000Z' }]);
  });

  it('schedules nothing without an expiry date, or when the reminder time has passed', () => {
    expect(planEstimateReminders(null, now)).toEqual([]);
    expect(planEstimateReminders('2026-09-29', now)).toEqual([]);
    expect(planEstimateReminders('2026-09-01', now)).toEqual([]);
  });

  it('still schedules when the reminder falls later today', () => {
    expect(planEstimateReminders('2026-09-30', now)).toEqual([{ kind: 'estimate_expiring', sendAfter: '2026-09-27T15:00:00.000Z' }]);
  });
});

describe('planInvoiceReminders()', () => {
  it('reminds 3 days before the due date and 1 day after it', () => {
    expect(planInvoiceReminders('2026-10-31', now)).toEqual([
      { kind: 'invoice_due_soon', sendAfter: '2026-10-28T15:00:00.000Z' },
      { kind: 'invoice_overdue', sendAfter: '2026-11-01T15:00:00.000Z' },
    ]);
  });

  it('keeps only the overdue reminder when the due date is too close for a heads-up', () => {
    expect(planInvoiceReminders('2026-09-28', now)).toEqual([{ kind: 'invoice_overdue', sendAfter: '2026-09-29T15:00:00.000Z' }]);
  });

  it('schedules nothing for an invoice already past due, or with no due date', () => {
    expect(planInvoiceReminders('2026-09-20', now)).toEqual([]);
    expect(planInvoiceReminders(null, now)).toEqual([]);
  });
});
