'use client';

import { useActionState } from 'react';
import { sendChangeOrderForAcceptanceAction, type SendChangeOrderState } from './actions';

const initialState: SendChangeOrderState = {};

// Mirrors app/(app)/estimates/[id]/send-estimate-button.tsx's shape exactly.
export function SendChangeOrderButton({ changeOrderId }: { changeOrderId: string }) {
  const [state, formAction, pending] = useActionState(sendChangeOrderForAcceptanceAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="changeOrderId" value={changeOrderId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send for acceptance'}
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
