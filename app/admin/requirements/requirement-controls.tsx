'use client';

import { useActionState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { MAX_TEXT_LENGTH, MAX_TITLE_LENGTH } from '@/lib/requirements/review';
import {
  setRequirementRetiredAction,
  updateRequirementAction,
  verifyRequirementAction,
  type RequirementActionState,
} from './actions';

const initialState: RequirementActionState = {};
const smallButton =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900';

function useResultToasts(state: RequirementActionState) {
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
}

export function VerifyButton({ requirementId, again }: { requirementId: string; again: boolean }) {
  const [state, formAction, pending] = useActionState(verifyRequirementAction, initialState);
  useResultToasts(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="requirementId" value={requirementId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? 'Saving…' : again ? 'Re-verify' : 'Verify'}
      </button>
    </form>
  );
}

export function RetireButton({ requirementId, retired }: { requirementId: string; retired: boolean }) {
  const [state, formAction, pending] = useActionState(setRequirementRetiredAction, initialState);
  useResultToasts(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="requirementId" value={requirementId} />
      <input type="hidden" name="retire" value={retired ? 'false' : 'true'} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Saving…' : retired ? 'Restore' : 'Retire'}
      </button>
    </form>
  );
}

export function EditRequirementForm({
  requirementId,
  title,
  description,
  appliesWhen,
}: {
  requirementId: string;
  title: string;
  description: string | null;
  appliesWhen: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateRequirementAction, initialState);
  useResultToasts(state);
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600">Edit</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="requirementId" value={requirementId} />
        <label className="flex flex-col gap-1 text-xs text-zinc-700">
          Title
          <input name="title" defaultValue={title} required maxLength={MAX_TITLE_LENGTH} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-700">
          Condition (leave blank if the city always requires it)
          <input name="appliesWhen" defaultValue={appliesWhen ?? ''} maxLength={MAX_TEXT_LENGTH} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-700">
          Details
          <textarea name="description" defaultValue={description ?? ''} maxLength={MAX_TEXT_LENGTH} rows={3} className={inputClass} />
        </label>
        <div>
          <button type="submit" disabled={pending} className={smallButton}>
            {pending ? 'Saving…' : 'Save (goes back to pending)'}
          </button>
        </div>
      </form>
    </details>
  );
}
