import { describe, it, expect } from 'vitest';
import { formatDateTime } from './date-time';

describe('formatDateTime()', () => {
  const signedAt = '2026-10-14T14:30:05.994Z';

  it('formats a time in the given zone, with the zone name', () => {
    const edmonton = formatDateTime(signedAt, { timeZone: 'America/Edmonton' })!;
    expect(edmonton).toContain('Oct 14, 2026');
    expect(edmonton).toMatch(/8:30/);
    expect(edmonton).toMatch(/MDT/);

    const toronto = formatDateTime(signedAt, { timeZone: 'America/Toronto' })!;
    expect(toronto).toMatch(/10:30/);
    expect(toronto).toMatch(/EDT/);
  });

  it('formats a date only, on the right day for the zone', () => {
    // 03:00 UTC on Oct 15 is still Oct 14 evening in Vancouver.
    expect(formatDateTime('2026-10-15T03:00:00Z', { dateOnly: true, timeZone: 'America/Vancouver' })).toBe('Oct 14, 2026');
  });

  it('returns null for an invalid date', () => {
    expect(formatDateTime('not a date')).toBeNull();
  });
});
