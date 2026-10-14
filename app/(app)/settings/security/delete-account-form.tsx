'use client';

import { useActionState, useState } from 'react';
import { deleteAccountAction, type DeleteAccountState } from './actions';

const CONFIRMATION = 'DELETE';

export function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, {});
  const [typed, setTyped] = useState('');

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-900">Delete account</h2>
      <div className="space-y-2 text-sm text-zinc-600">
        <p>This permanently deletes your sign-in and personal details. It can&apos;t be undone.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>If you&apos;re the only member of your company, the company is deleted too, with all its applications, documents, files, estimates and invoices.</li>
          <li>If you share the company with others, it keeps its records (shown as a deleted user). If you&apos;re its only owner, first make someone else an owner in Team.</li>
        </ul>
        <p>Download anything you want to keep first.</p>
      </div>
      <label htmlFor="delete-confirm" className="text-sm font-medium text-zinc-700">
        Type {CONFIRMATION} to confirm
      </label>
      <input
        id="delete-confirm"
        name="confirm"
        autoComplete="off"
        autoCapitalize="characters"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
      />
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || typed.trim() !== CONFIRMATION}
        className="self-start rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Delete my account'}
      </button>
    </form>
  );
}
