'use client';

import { useActionState } from 'react';
import { revokeApiKeyAction, type RevokeApiKeyState } from './actions';

const initialState: RevokeApiKeyState = {};

export function RevokeButton({ keyId, keyName }: { keyId: string; keyName: string }) {
  const [state, formAction, pending] = useActionState(revokeApiKeyAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Revoke “${keyName}”? Anything using it will stop working immediately.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="keyId" value={keyId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-700 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
