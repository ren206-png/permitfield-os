import { computeEffectiveVerificationStatus } from '@/lib/jurisdictions/staleness';

// Requirements review (admin): what a reviewer sees for each catalog
// requirement (permit_requirements, migration 080) and the checks applied to
// an edit. Pure, so the rules are unit-tested; the admin page and its server
// actions (app/admin/requirements/) do the reading and writing.

export type ReviewStatus = 'verified' | 'stale' | 'pending' | 'retired';

export interface ReviewableRequirement {
  verification_status: string;
  verified_at: string | null;
  archived_at: string | null;
}

/**
 * Retired wins; then a verified row older than the staleness threshold
 * (lib/jurisdictions/staleness.ts, 180 days) is stale; anything not verified
 * is pending.
 */
export function reviewStatus(row: ReviewableRequirement, now: Date = new Date()): ReviewStatus {
  if (row.archived_at) return 'retired';
  if (row.verification_status !== 'verified') return 'pending';
  return computeEffectiveVerificationStatus('verified', row.verified_at, undefined, now) === 'stale' ? 'stale' : 'verified';
}

export type ReviewCounts = Record<ReviewStatus, number> & { total: number };

export function reviewCounts(rows: ReviewableRequirement[], now: Date = new Date()): ReviewCounts {
  const counts: ReviewCounts = { verified: 0, stale: 0, pending: 0, retired: 0, total: 0 };
  for (const row of rows) {
    counts[reviewStatus(row, now)] += 1;
    counts.total += 1;
  }
  return counts;
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_LENGTH = 1000;

export interface RequirementEdit {
  title: string;
  description: string | null;
  appliesWhen: string | null;
}

/** Trims and validates an edit; blank description or condition becomes null. */
export function parseRequirementEdit(input: { title: unknown; description: unknown; appliesWhen: unknown }): RequirementEdit | { error: string } {
  const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
  const title = text(input.title);
  const description = text(input.description);
  const appliesWhen = text(input.appliesWhen);
  if (!title) return { error: 'The requirement needs a title.' };
  if (title.length > MAX_TITLE_LENGTH) return { error: `Keep the title under ${MAX_TITLE_LENGTH} characters.` };
  if (description.length > MAX_TEXT_LENGTH || appliesWhen.length > MAX_TEXT_LENGTH) {
    return { error: `Keep the description and condition under ${MAX_TEXT_LENGTH} characters each.` };
  }
  return { title, description: description || null, appliesWhen: appliesWhen || null };
}
