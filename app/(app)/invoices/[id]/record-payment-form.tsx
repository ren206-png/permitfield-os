'use client';

import { useActionState, useState } from 'react';
import { recordPaymentAction, type RecordPaymentState } from './actions';

const initialState: RecordPaymentState = {};

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

// Phase A scope: manual payment recording only (e-transfer / cheque), one
// allocation per payment (the full amount applied to this invoice) --
// lib/quotes-payments/payments.ts's recordPayment() supports multi-invoice
// allocations, but there is no multi-invoice picker anywhere in this UI
// (no "client statement" page exists yet), so this form always sends a
// single-element allocations array.
export function RecordPaymentForm({ invoiceId, clientId }: { invoiceId: string; clientId: string }) {
  const [state, formAction, pending] = useActionState(recordPaymentAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
      >
        Record payment
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label htmlFor="method" className={labelClass}>
          Method
        </label>
        <select id="method" name="method" required className={inputClass} defaultValue="e_transfer">
          <option value="e_transfer">E-transfer</option>
          <option value="cheque">Cheque</option>
        </select>
      </div>

      <div>
        <label htmlFor="amount" className={labelClass}>
          Amount
        </label>
        <input id="amount" name="amount" inputMode="decimal" placeholder="0.00" required className={inputClass} />
      </div>

      <div>
        <label htmlFor="receivedAt" className={labelClass}>
          Received date
        </label>
        <input id="receivedAt" name="receivedAt" type="date" required className={inputClass} />
      </div>

      <div>
        <label htmlFor="referenceNote" className={labelClass}>
          Reference (optional)
        </label>
        <input id="referenceNote" name="referenceNote" placeholder="Confirmation code or cheque number" className={inputClass} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Recording…' : 'Save payment'}
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
