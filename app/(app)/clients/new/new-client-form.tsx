'use client';

import { useActionState } from 'react';
import { createClientAction, type NewClientState } from './actions';
import { useErrorToast } from '@/components/toast/use-action-toast';

// Same input/label classes and useActionState shape as
// app/(app)/contractors/new/new-contractor-form.tsx.
const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: NewClientState = {};

export function NewClientForm() {
  const [state, formAction, pending] = useActionState(createClientAction, initialState);
  useErrorToast(state.error);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input id="name" name="name" required className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email (optional)
          </label>
          <input id="email" name="email" type="email" className={inputClass} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone (optional)
          </label>
          <input id="phone" name="phone" type="tel" className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes (optional)
        </label>
        <textarea id="notes" name="notes" rows={3} className={inputClass} />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add client'}
      </button>
    </form>
  );
}
