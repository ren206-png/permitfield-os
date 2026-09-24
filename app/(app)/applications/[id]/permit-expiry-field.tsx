'use client';

import { useActionState } from 'react';
import { updatePermitExpiryAction, type PermitExpiryState } from './permit-expiry-actions';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';

const initialState: PermitExpiryState = {};

// Deadline/expiry alerts, slice 2 (MARKETING_CAPABILITY_LEDGER.md §17
// follow-up). Same useActionState + toast wiring as
// app/(app)/contractors/new/new-contractor-form.tsx, adapted for an
// edit-in-place field on an existing row rather than a create form.
export function PermitExpiryField({ applicationId, permitExpiresOn }: { applicationId: string; permitExpiresOn: string | null }) {
  const [state, formAction, pending] = useActionState(updatePermitExpiryAction, initialState);
  useErrorToast(state.error);
  useSuccessToast(state.success, 'Permit expiry date saved.');

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="flex-1">
        <label htmlFor="permitExpiresOn" className="mb-1 block text-xs font-medium text-zinc-500">
          Permit expiry date (optional)
        </label>
        <input
          id="permitExpiresOn"
          name="permitExpiresOn"
          type="date"
          defaultValue={permitExpiresOn ?? ''}
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
