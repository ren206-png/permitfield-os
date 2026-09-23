'use client';

import { useActionState } from 'react';
import { payInvoiceAction, type PayInvoiceState } from './actions';

const initialState: PayInvoiceState = {};

/** Gate 4 (Quotes & Payments), Phase C. Redirects to a Stripe Checkout Session for this invoice's full outstanding balance -- see actions.ts's own header comment for why no entitlement check gates this, only isQuotesPaymentsOnlineEnabled() + a data-level onboarding check. */
export function PayNowButton({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(payInvoiceAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Redirecting…' : 'Pay now'}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
