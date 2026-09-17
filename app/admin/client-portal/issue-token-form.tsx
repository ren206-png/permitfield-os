'use client';

import { useActionState } from 'react';
import { issueTokenAction, type IssueTokenState } from './actions';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';

const inputClass = 'rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-xs font-medium text-zinc-600';

const initialState: IssueTokenState = {};

export function IssueTokenForm({ applicationId, orgId }: { applicationId: string; orgId: string }) {
  const [state, formAction, pending] = useActionState(issueTokenAction, initialState);
  useErrorToast(state.error);
  // Deliberately doesn't put the raw token itself in the toast -- the
  // amber block below is this action's one durable, non-auto-dismissing
  // place to read it back ("copy it now, it will not be shown again
  // anywhere" per that block's own text). A toast that vanishes after
  // AUTO_DISMISS_MS is the wrong surface for a value the operator might
  // still be about to copy.
  useSuccessToast(Boolean(state.issuedRawToken), 'Token issued.');

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="orgId" value={orgId} />

      <div>
        <label htmlFor={`recipientEmail-${applicationId}`} className={labelClass}>
          Recipient email
        </label>
        <input id={`recipientEmail-${applicationId}`} name="recipientEmail" type="email" required className={inputClass} />
      </div>

      <div>
        <label htmlFor={`recipientName-${applicationId}`} className={labelClass}>
          Recipient name (optional)
        </label>
        <input id={`recipientName-${applicationId}`} name="recipientName" type="text" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Issuing…' : 'Issue token'}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {state.error}
        </p>
      )}

      {state.issuedRawToken && (
        <div className="mt-2 w-full rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">
            Token issued for {state.issuedRecipientEmail}. Copy it now -- it will not be shown again anywhere.
          </p>
          <p className="mt-1 break-all font-mono">{state.issuedRawToken}</p>
          <p className="mt-1 text-amber-700">
            Expires {state.issuedExpiresAt ? new Date(state.issuedExpiresAt).toLocaleString() : 'unknown'}.
          </p>
        </div>
      )}
    </form>
  );
}
