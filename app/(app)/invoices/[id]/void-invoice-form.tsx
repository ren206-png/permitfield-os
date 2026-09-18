'use client';

import { useActionState, useState } from 'react';
import { voidInvoiceAction, type VoidInvoiceState } from './actions';

const initialState: VoidInvoiceState = {};

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';

/** Voiding an issued invoice never reclaims its invoice_number (void_invoice()'s own RPC contract) -- this form is deliberately just a reason field + confirm button, no "undo". */
export function VoidInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState(voidInvoiceAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
      >
        Void invoice
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label htmlFor="voidReason" className="text-sm font-medium text-zinc-700">
        Reason (optional)
      </label>
      <input id="voidReason" name="voidReason" className={inputClass} placeholder="Why is this invoice being voided?" />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Voiding…' : 'Confirm void'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
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
