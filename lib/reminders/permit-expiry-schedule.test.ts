import { describe, it, expect } from 'vitest';
import { computePermitExpiryReminderSendAfter, PERMIT_EXPIRY_REMINDER_LEAD_DAYS } from './permit-expiry-schedule';

describe('computePermitExpiryReminderSendAfter', () => {
  it('subtracts the lead time from the expiry date', () => {
    const sendAfter = computePermitExpiryReminderSendAfter('2027-02-01');
    expect(sendAfter).toBe('2027-01-02T00:00:00.000Z');
  });

  it(`is exactly ${PERMIT_EXPIRY_REMINDER_LEAD_DAYS} days before the expiry date`, () => {
    const expiresOn = new Date('2028-06-15T00:00:00.000Z');
    const sendAfter = new Date(computePermitExpiryReminderSendAfter('2028-06-15'));
    const diffDays = (expiresOn.getTime() - sendAfter.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(PERMIT_EXPIRY_REMINDER_LEAD_DAYS);
  });

  it('returns a past timestamp (not clamped) when the expiry is already inside the lead window', () => {
    const soonExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sendAfter = new Date(computePermitExpiryReminderSendAfter(soonExpiry));
    expect(sendAfter.getTime()).toBeLessThan(Date.now());
  });
});
