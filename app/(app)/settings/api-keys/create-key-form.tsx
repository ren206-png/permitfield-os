'use client';

import { useActionState, useState } from 'react';
import { createApiKeyAction, type CreateApiKeyState } from './actions';

const initialState: CreateApiKeyState = {};

export function CreateKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initialState);
  const [copied, setCopied] = useState(false);

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="api-key-name" className="sr-only">
          Key name
        </label>
        <input
          id="api-key-name"
          name="name"
          required
          maxLength={100}
          placeholder="Key name, e.g. Reporting integration"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}

      {state.createdKey && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy “{state.createdName}” now. You won’t be able to see it again.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs text-zinc-900">
              {state.createdKey}
            </code>
            <button
              type="button"
              onClick={() => copyKey(state.createdKey!)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
