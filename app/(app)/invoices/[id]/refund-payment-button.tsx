'use client';

import { useActionState } from 'react';
import { refundOnlinePaymentAction, type ReversePaymentState } from './actions';

const initialState: ReversePaymentState = {};

/**
 * Returns a card payment to the customer through Stripe, then marks the
 * payment reversed in the ledger. Unlike the manual Reverse button this moves
 * real money, so it asks for confirmation first and cannot be undone.
 */
export function RefundPaymentButton({
  paymentId,
  invoiceId,
  amountLabel,
}: {
  paymentId: string;
  invoiceId: string;
  amountLabel: string;
}) {
  const [state, formAction, pending] = useActionState(refundOnlinePaymentAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Refund ${amountLabel} to the customer's card? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Refunding…' : 'Refund'}
      </button>
      {state.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
