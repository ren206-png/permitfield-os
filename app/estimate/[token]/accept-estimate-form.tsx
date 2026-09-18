'use client';

import { useActionState } from 'react';
import { acceptEstimateAction, type AcceptEstimateState } from './actions';

const initialState: AcceptEstimateState = {};

// Gate 4 (Quotes & Payments), Phase A -- the public "Accept" form for
// app/estimate/[token]/page.tsx. Typed name + claimed authority, matching
// record_estimate_acceptance()'s own required (`p_typed_name`,
// `p_claimed_authority`) params exactly -- no e-signature drawing/upload,
// no decline option (no declineEstimate() function exists anywhere in this
// codebase; confirmed by grep before writing this).
export function AcceptEstimateForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptEstimateAction, initialState);

  if (state.accepted) {
    return <p className="text-sm font-medium text-emerald-700">Thank you -- this estimate has been accepted.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />

      <h2 className="text-sm font-medium text-zinc-900">Accept this estimate</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">Your full name</span>
        <input
          type="text"
          name="typedName"
          required
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
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          placeholder="Property owner, Project manager, etc."
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Accept estimate'}
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
