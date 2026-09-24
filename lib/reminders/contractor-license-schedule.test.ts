import { describe, it, expect } from 'vitest';
import { computeContractorLicenseReminderSendAfter, CONTRACTOR_LICENSE_REMINDER_LEAD_DAYS } from './contractor-license-schedule';

describe('computeContractorLicenseReminderSendAfter', () => {
  it('subtracts the lead time from the expiry date', () => {
    const sendAfter = computeContractorLicenseReminderSendAfter('2027-02-01');
    expect(sendAfter).toBe('2027-01-02T00:00:00.000Z');
  });

  it(`is exactly ${CONTRACTOR_LICENSE_REMINDER_LEAD_DAYS} days before the expiry date`, () => {
    const expiresOn = new Date('2028-06-15T00:00:00.000Z');
    const sendAfter = new Date(computeContractorLicenseReminderSendAfter('2028-06-15'));
    const diffDays = (expiresOn.getTime() - sendAfter.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(CONTRACTOR_LICENSE_REMINDER_LEAD_DAYS);
  });

  it('returns a past timestamp (not clamped) when the expiry is already inside the lead window', () => {
    const soonExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sendAfter = new Date(computeContractorLicenseReminderSendAfter(soonExpiry));
    expect(sendAfter.getTime()).toBeLessThan(Date.now());
  });
});
