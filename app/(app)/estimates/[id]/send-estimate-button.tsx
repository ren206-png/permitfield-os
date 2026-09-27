'use client';

import { useActionState } from 'react';
import { sendEstimateAction, type SendEstimateState } from './actions';

const initialState: SendEstimateState = {};

// Rendered for every status, not only drafts: a successful send flips the
// estimate to `sent` and revalidates the page, and if this component
// unmounted then, its result (whether the client was emailed, or the link to
// share by hand when the email failed) would be lost with it. The form
// itself only shows while the estimate is still a draft.
export function SendEstimateButton({
  estimateId,
  isDraft,
  clientEmail,
  canEmailClient,
}: {
  estimateId: string;
  isDraft: boolean;
  clientEmail: string | null;
  /** False when client portal links are off -- there is no link to email. */
  canEmailClient: boolean;
}) {
  const [state, formAction, pending] = useActionState(sendEstimateAction, initialState);
  const hasResult = Boolean(state.sentMessage || state.emailWarning || state.shareUrl);

  if (!isDraft && !hasResult) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {isDraft && (
        <form action={formAction} className="flex flex-col items-start gap-2">
          <input type="hidden" name="estimateId" value={estimateId} />
          {canEmailClient && clientEmail && (
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="emailClient" defaultChecked className="h-4 w-4 rounded border-zinc-300" />
              Email the client a link to view it ({clientEmail})
            </label>
          )}
          {canEmailClient && !clientEmail && (
            <p className="text-sm text-zinc-500">This client has no email on file, so they won&apos;t be emailed.</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send estimate'}
          </button>
        </form>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.reviewMessage && <p className="text-sm text-amber-700">{state.reviewMessage}</p>}
      {state.sentMessage && (
        <p role="status" className="text-sm text-emerald-700">
          {state.sentMessage}
        </p>
      )}
      {state.emailWarning && (
        <p role="alert" className="text-sm text-amber-700">
          {state.emailWarning}
        </p>
      )}
      {state.shareUrl && (
        <div className="w-full rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Client link. Copy it now -- it will not be shown again here.</p>
          <p className="mt-1 break-all font-mono">{state.shareUrl}</p>
        </div>
      )}
    </div>
  );
}
