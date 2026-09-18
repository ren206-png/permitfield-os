'use client';

import { useActionState } from 'react';
import { generateEstimateClientLinkAction, type GenerateEstimateClientLinkState } from './actions';

const initialState: GenerateEstimateClientLinkState = {};

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/admin/client-portal/issue-token-form.tsx's own "show the raw
// value once, in a highlighted box, with an explicit never-shown-again
// warning" convention -- the only structural difference is this button
// takes no recipient-email input (the estimate's own client email is used
// server-side; see generateEstimateClientLinkAction's own comment).
export function GenerateEstimateClientLinkButton({ estimateId }: { estimateId: string }) {
  const [state, formAction, pending] = useActionState(generateEstimateClientLinkAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="estimateId" value={estimateId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Generating…' : 'Copy client link'}
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state.shareUrl && (
        <div className="w-full rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Client link generated. Copy it now -- it will not be shown again here.</p>
          <p className="mt-1 break-all font-mono">{state.shareUrl}</p>
          <p className="mt-1 text-amber-700">
            Expires {state.expiresAt ? new Date(state.expiresAt).toLocaleString() : 'unknown'}. Generating again
            supersedes this link.
          </p>
        </div>
      )}
    </form>
  );
}
