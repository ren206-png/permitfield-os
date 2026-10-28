// Gate 6.3: freshness policy for registered sources (master prompt §7:
// "configurable freshness policy by source type; stale/overdue is visible
// and blocks definitive claims"). Pure, so the console, the scheduler and
// (in 6.4) the copilot all apply the same rule.
//
// "Last successful check" means a check that reached the source and read it
// (changed, unchanged or 304). A failed or blocked check never refreshes a
// source -- and never retires it either.

export type SourceType = 'fee_schedule' | 'processing_times' | 'forms_page' | 'bylaw' | 'other';

export const FRESHNESS_POLICY_DAYS: Record<SourceType, number> = {
  fee_schedule: 30,
  processing_times: 30,
  forms_page: 30,
  bylaw: 90,
  other: 90,
};

// After a failed attempt the scheduler waits this long before trying again.
export const RETRY_AFTER_FAILURE_HOURS = 24;

export type Freshness = 'fresh' | 'overdue' | 'never_checked';

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function computeFreshness(sourceType: SourceType, lastSuccessfulCheckAt: Date | string | null, now: Date = new Date()): Freshness {
  const last = toMs(lastSuccessfulCheckAt);
  if (last === null) return 'never_checked';
  return now.getTime() - last <= FRESHNESS_POLICY_DAYS[sourceType] * DAY_MS ? 'fresh' : 'overdue';
}

export function isCheckDue(
  sourceType: SourceType,
  lastSuccessfulCheckAt: Date | string | null,
  lastAttemptAt: Date | string | null,
  now: Date = new Date()
): boolean {
  if (computeFreshness(sourceType, lastSuccessfulCheckAt, now) === 'fresh') return false;
  const attempt = toMs(lastAttemptAt);
  return attempt === null || now.getTime() - attempt >= RETRY_AFTER_FAILURE_HOURS * 60 * 60 * 1000;
}
