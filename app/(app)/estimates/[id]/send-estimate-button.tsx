'use client';

import { useActionState } from 'react';
import { sendEstimateAction, type SendEstimateState } from './actions';

const initialState: SendEstimateState = {};

export function SendEstimateButton({ estimateId }: { estimateId: string }) {
  const [state, formAction, pending] = useActionState(sendEstimateAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="estimateId" value={estimateId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send estimate'}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.reviewMessage && <p className="text-sm text-amber-700">{state.reviewMessage}</p>}
    </form>
  );
}
