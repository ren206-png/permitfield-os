'use client';

import { useActionState, useState } from 'react';
import { cancelSignatureAction, requestSignatureAction, type SignatureActionState } from './signature-actions';

const initialState: SignatureActionState = {};

const buttonClass =
  'rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60';

function Result({ state }: { state: SignatureActionState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-xs text-red-600">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <div role="status" className="mt-2 flex flex-col gap-1 text-xs text-emerald-700">
      <p>{state.message}</p>
      {state.signUrl && (
        <div className="flex items-center gap-2">
          <input readOnly value={state.signUrl} className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-zinc-700" />
          <button
            type="button"
            className="font-medium text-zinc-900 underline underline-offset-2"
            onClick={() => {
              void navigator.clipboard.writeText(state.signUrl ?? '').then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  );
}

export function RequestSignatureForm({
  applicationId,
  filingId,
  signerRole,
  defaultName,
  defaultEmail,
  submitLabel,
}: {
  applicationId: string;
  filingId: string;
  signerRole: 'applicant' | 'owner';
  defaultName: string;
  defaultEmail: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(requestSignatureAction, initialState);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  return (
    <form action={formAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="filingId" value={filingId} />
      <input type="hidden" name="signerRole" value={signerRole} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
          Signer&apos;s name
          <input
            name="signerName"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
          Signer&apos;s email
          <input
            name="signerEmail"
            type="email"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Sending…' : submitLabel}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function CancelSignatureButton({ applicationId, requestId }: { applicationId: string; requestId: string }) {
  const [state, formAction, pending] = useActionState(cancelSignatureAction, initialState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="requestId" value={requestId} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-zinc-700 underline underline-offset-2 disabled:opacity-60">
        {pending ? 'Cancelling…' : 'Cancel request'}
      </button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
