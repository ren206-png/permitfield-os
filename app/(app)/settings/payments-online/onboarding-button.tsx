'use client';

import { useActionState } from 'react';
import { startConnectOnboardingAction, type StartConnectOnboardingState } from './actions';

const initialState: StartConnectOnboardingState = {};

export function OnboardingButton({ label }: { label: string }) {
  const [state, formAction, pending] = useActionState(startConnectOnboardingAction, initialState);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Redirecting…' : label}
      </button>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
