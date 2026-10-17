import { BILLING_TIERS } from '@/lib/billing/tiers';

// Founding-customer offer (decided 2026-10-14): the first 10 companies to
// sign up during early access get 25% off for as long as they keep a paid
// plan. "First" is by organization creation time; organizations with a
// platform admin (ADMIN_EMAILS) as a member are our own and never take a
// place. When live billing ships, apply this as a Stripe coupon (25% off,
// duration "forever") to the founding orgs.
export const FOUNDING_CUSTOMER_LIMIT = 10;
export const FOUNDING_DISCOUNT_PERCENT = 25;

// Pay per permit (CA$ per application) -- decided alongside the plans, not
// sold yet (no checkout for it exists).
const PAY_PER_PERMIT_CENTS = 7900;

export type PriceLine = { name: string; detail: string; regularCents: number; unit: string };

export const EARLY_ACCESS_PRICE_LINES: PriceLine[] = [
  { name: 'Starter', detail: 'Up to 10 active applications', regularCents: BILLING_TIERS.starter.priceCents ?? 0, unit: '/month' },
  { name: 'Pro', detail: 'Up to 50, plus the AI compliance check and API access', regularCents: BILLING_TIERS.pro.priceCents ?? 0, unit: '/month' },
  { name: 'Pay per permit', detail: 'No monthly plan', regularCents: PAY_PER_PERMIT_CENTS, unit: ' per application' },
];

// The founding price, rounded to the whole dollar (CA$149 -> CA$112).
export function foundingPriceCents(regularCents: number): number {
  return Math.round((regularCents * (100 - FOUNDING_DISCOUNT_PERCENT)) / 100 / 100) * 100;
}

export function formatCad(cents: number): string {
  return `CA$${(cents / 100).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
}

// 1-based founding place of `orgId`, or null if it isn't one of the first
// FOUNDING_CUSTOMER_LIMIT customer organizations. `orgs` must be sorted
// oldest first; `internalOrgIds` are our own organizations.
export function foundingRank(
  orgs: readonly { id: string }[],
  internalOrgIds: ReadonlySet<string>,
  orgId: string
): number | null {
  const customers = orgs.filter((org) => !internalOrgIds.has(org.id));
  const index = customers.findIndex((org) => org.id === orgId);
  return index >= 0 && index < FOUNDING_CUSTOMER_LIMIT ? index + 1 : null;
}
