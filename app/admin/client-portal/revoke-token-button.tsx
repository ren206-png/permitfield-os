'use client';

import { useActionState } from 'react';
import { revokeTokenAction, type RevokeTokenState } from './actions';

const initialState: RevokeTokenState = {};

export function RevokeTokenButton({ tokenId }: { tokenId: string }) {
  const [state, formAction, pending] = useActionState(revokeTokenAction, initialState);

  if (state.revoked) {
    return <span className="text-xs text-zinc-500">Revoked</span>;
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="tokenId" value={tokenId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
