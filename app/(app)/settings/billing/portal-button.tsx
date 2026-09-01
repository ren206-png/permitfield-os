'use client';

import { useActionState } from 'react';
import { portalAction, type BillingActionState } from './actions';

const initialState: BillingActionState = {};

// Opens Stripe's hosted Customer Portal, scoped (server-side, in
// lib/billing/subscriptions.ts's createPortalSessionUrl) to payment-method
// update and cancellation only -- not plan switching, which stays on the
// CheckoutButton path above so no Stripe Dashboard "portal configuration"
// of Price IDs is required (BILLING_PROPOSAL.md §3).
export function PortalButton() {
  const [state, formAction, pending] = useActionState(portalAction, initialState);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Opening…' : 'Manage payment method / cancel'}
      </button>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
