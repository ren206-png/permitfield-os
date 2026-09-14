'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { issueChangeOrderAction, type IssueChangeOrderState } from './actions';

const initialState: IssueChangeOrderState = {};

/** Calls issueChangeOrderAction, which creates (but does not itself issue) a brand new draft invoice for the accepted delta -- see that action's own comment. On success this renders a link to the new draft invoice rather than redirecting there automatically, so staff stay on this page long enough to see the outcome recorded before navigating on. */
export function IssueChangeOrderButton({ changeOrderId }: { changeOrderId: string }) {
  const [state, formAction, pending] = useActionState(issueChangeOrderAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="changeOrderId" value={changeOrderId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Issuing…' : 'Issue change order'}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.newInvoiceId && (
        <p className="text-sm text-emerald-700">
          Created draft invoice.{' '}
          <Link href={`/invoices/${state.newInvoiceId}`} className="underline">
            Open it to issue
          </Link>
          .
        </p>
      )}
    </form>
  );
}
