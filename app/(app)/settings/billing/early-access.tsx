import {
  EARLY_ACCESS_PRICE_LINES,
  FOUNDING_CUSTOMER_LIMIT,
  FOUNDING_DISCOUNT_PERCENT,
  formatCad,
  foundingPriceCents,
} from '@/lib/billing/founding';
import { SUPPORT_EMAIL } from '@/lib/brand';

// Billing while PermitField is free (PERMITFIELD_FF_BILLING off): where the
// customer stands, what the plans will cost, and their founding-customer
// discount. No payment form -- the Stripe checkout replaces this page when
// live billing is switched on.
export function EarlyAccessBilling({ foundingRank }: { foundingRank: number | null }) {
  const founding = foundingRank !== null;
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-zinc-900">Billing</h1>
      <p className="mt-1 text-sm text-zinc-600">Your plan and what PermitField will cost once paid plans start.</p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Current plan</p>
        <p className="mt-1 text-lg font-semibold text-zinc-900">Early access: free</p>
        <p className="mt-1 text-sm text-zinc-600">
          No card needed. You&apos;ll get at least 30 days&apos; notice by email before any charge, and you can stop at any time.
        </p>
      </div>

      {founding && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <p className="text-sm font-semibold text-emerald-900">
            Founding customer #{foundingRank} of {FOUNDING_CUSTOMER_LIMIT}
          </p>
          <p className="mt-1 text-sm text-emerald-800">
            Thanks for being one of our first firms. You have {FOUNDING_DISCOUNT_PERCENT}% off locked in for as long as you keep a
            paid plan.
          </p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Plans once early access ends</h2>
        <ul className="mt-3 divide-y divide-zinc-100">
          {EARLY_ACCESS_PRICE_LINES.map((line) => (
            <li key={line.name} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">{line.name}</p>
                <p className="text-xs text-zinc-500">{line.detail}</p>
              </div>
              <p className="shrink-0 text-right text-sm text-zinc-900">
                {founding ? (
                  <>
                    <span className="mr-2 text-zinc-400 line-through">{formatCad(line.regularCents)}</span>
                    <span className="font-semibold text-emerald-700">{formatCad(foundingPriceCents(line.regularCents))}</span>
                  </>
                ) : (
                  <span className="font-semibold">{formatCad(line.regularCents)}</span>
                )}
                <span className="text-xs text-zinc-500">{line.unit}</span>
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-zinc-500">Prices in Canadian dollars, plus applicable tax.</p>
      </div>

      <p className="mt-4 text-sm text-zinc-600">
        Questions about pricing? Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
