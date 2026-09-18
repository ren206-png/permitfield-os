'use client';

import { useActionState, useState } from 'react';
import { issueCreditNoteAction, type IssueCreditNoteState } from './actions';

const initialState: IssueCreditNoteState = {};

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

/** Mirrors RecordPaymentForm's open/closed shape. Creates and issues a credit note in one step -- see issueCreditNoteAction's own header comment for why there is no separate draft-review step. */
export function IssueCreditNoteForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState(issueCreditNoteAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
      >
        Issue credit note
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <div>
        <label htmlFor="cn-amount" className={labelClass}>
          Amount
        </label>
        <input id="cn-amount" name="amount" inputMode="decimal" placeholder="0.00" required className={inputClass} />
      </div>

      <div>
        <label htmlFor="cn-reason" className={labelClass}>
          Reason (optional)
        </label>
        <input id="cn-reason" name="reason" placeholder="Why is this credit being issued?" className={inputClass} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Issuing…' : 'Issue credit note'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          Cancel
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
