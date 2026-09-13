'use client';

import { useActionState } from 'react';
import { issueInvoiceAction, type IssueInvoiceState } from './actions';

const initialState: IssueInvoiceState = {};

// Mirrors app/(app)/estimates/[id]/send-estimate-button.tsx's shape exactly.
export function IssueInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState(issueInvoiceAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Issuing…' : 'Issue invoice'}
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
