'use client';

import { useActionState } from 'react';
import { emailFilingAction, recordFilingAction, type SubmissionActionState } from './submission-actions';

const initialState: SubmissionActionState = {};

function Result({ state }: { state: SubmissionActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-xs text-red-600">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="mt-2 text-xs text-emerald-700">
        {state.message}
      </p>
    );
  }
  return null;
}

const buttonClass =
  'rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60';

export function EmailSubmitButton({
  applicationId,
  filingId,
  authorityName,
  toEmail,
  projectAddress,
  testMode = false,
}: {
  applicationId: string;
  filingId: string;
  authorityName: string;
  toEmail: string;
  projectAddress: string;
  testMode?: boolean;
}) {
  const [state, formAction, pending] = useActionState(emailFilingAction, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const question = testMode
          ? `Send a TEST submission for ${projectAddress} to ${toEmail}? It will not go to ${authorityName}.`
          : `Email the application for ${projectAddress} to ${authorityName} (${toEmail})? This sends it to the authority and can't be undone.`;
        if (!window.confirm(question)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="filingId" value={filingId} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Sending…' : `Email to ${authorityName}`}
      </button>
      <Result state={state} />
    </form>
  );
}

export function RecordSubmissionForm({
  applicationId,
  filingId,
  method,
}: {
  applicationId: string;
  filingId: string;
  method: 'portal' | 'in_person';
}) {
  const [state, formAction, pending] = useActionState(recordFilingAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="filingId" value={filingId} />
      <input type="hidden" name="method" value={method} />
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
        {method === 'portal' ? 'Portal application or permit number (optional)' : 'Receipt or file number (optional)'}
        <input
          name="externalReference"
          maxLength={200}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          placeholder="e.g. BP-2026-01234"
        />
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Recording…' : method === 'portal' ? 'I’ve submitted it online' : 'I’ve filed it in person'}
      </button>
      <Result state={state} />
    </form>
  );
}
