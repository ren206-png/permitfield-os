'use client';

import { useActionState } from 'react';
import { reversePaymentAction, type ReversePaymentState } from './actions';

const initialState: ReversePaymentState = {};

/** reverse_payment() never edits/deletes the original row (see lib/quotes-payments/payments.ts's header comment) -- this just flips status to 'reversed'. No confirmation step beyond the button itself, matching this page's other single-click actions. */
export function ReversePaymentButton({ paymentId, invoiceId }: { paymentId: string; invoiceId: string }) {
  const [state, formAction, pending] = useActionState(reversePaymentAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Reversing…' : 'Reverse'}
      </button>
      {state.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
