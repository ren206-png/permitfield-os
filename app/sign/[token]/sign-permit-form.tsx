'use client';

import { useActionState, useState } from 'react';
import { SignatureField } from '@/components/esign/signature-field';
import { signPermitFormAction, type SignPermitFormState } from './actions';

const initialState: SignPermitFormState = {};

export function SignPermitForm({ token, documentId, defaultName }: { token: string; documentId: string; defaultName: string }) {
  const [state, formAction, pending] = useActionState(signPermitFormAction, initialState);
  const [typedName, setTypedName] = useState(defaultName);

  if (state.signed) {
    return <p className="text-sm font-medium text-emerald-700">Thank you -- the form is signed. The sender has been given the signed copy.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="documentId" value={documentId} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">Your full name</span>
        <input
          type="text"
          name="typedName"
          required
          maxLength={200}
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
        />
      </label>

      <SignatureField typedName={typedName} />

      <button
        type="submit"
        disabled={pending}
        className="mt-1 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing…' : 'Sign the form'}
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
