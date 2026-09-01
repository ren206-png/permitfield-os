'use client';

import { useActionState } from 'react';
import { checkoutAction, type BillingActionState } from './actions';
import type { BillingTierId } from '@/lib/billing/tiers';

const initialState: BillingActionState = {};

// One instance per self-serve tier button (Starter/Pro) -- same
// "one hidden field baked in per rendered instance, same action, useActionState
// per instance" shape as app/admin/client-portal/revoke-token-button.tsx.
export function CheckoutButton({ tier, label }: { tier: BillingTierId; label: string }) {
  const [state, formAction, pending] = useActionState(checkoutAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Redirecting…' : label}
      </button>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
