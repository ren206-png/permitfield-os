'use client';

import { useActionState, useState } from 'react';
import { SignatureField } from '@/components/esign/signature-field';
import { acceptChangeOrderAction, type AcceptChangeOrderState } from './actions';

const initialState: AcceptChangeOrderState = {};

// The public "Accept and sign" form for app/change-order/[token]/page.tsx.
// Same shape as app/estimate/[token]/accept-estimate-form.tsx: typed name +
// claimed authority plus electronic-signature consent and a typed or drawn
// signature (20260806000069). No decline path for change orders.
export function AcceptChangeOrderForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptChangeOrderAction, initialState);
  const [typedName, setTypedName] = useState('');
  const [claimedAuthority, setClaimedAuthority] = useState('');

  if (state.accepted) {
    return <p className="text-sm font-medium text-emerald-700">Thank you -- this change order has been accepted and signed.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />

      <h2 className="text-sm font-medium text-zinc-900">Accept and sign this change order</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">Your full name</span>
        <input
          type="text"
          name="typedName"
          required
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          placeholder="Jane Smith"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">Your role or title</span>
        <input
          type="text"
          name="claimedAuthority"
          required
          value={claimedAuthority}
          onChange={(event) => setClaimedAuthority(event.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          placeholder="Property owner, Project manager, etc."
        />
      </label>

      <SignatureField typedName={typedName} />

      <button
        type="submit"
        disabled={pending}
        className="mt-1 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Accept and sign'}
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
