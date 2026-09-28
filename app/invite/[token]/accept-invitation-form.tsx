'use client';

import { useActionState } from 'react';
import { acceptInvitationAction, type AcceptInvitationState } from './actions';

const initialState: AcceptInvitationState = {};

export function AcceptInvitationForm({ token, organizationName }: { token: string; organizationName: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Joining…' : `Join ${organizationName}`}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
