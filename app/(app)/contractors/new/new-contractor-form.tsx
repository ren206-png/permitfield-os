'use client';

import { useActionState } from 'react';
import { createContractorAction, type NewContractorState } from './actions';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: NewContractorState = {};

export function NewContractorForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction, pending] = useActionState(createContractorAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <div>
        <label htmlFor="companyName" className={labelClass}>
          Company name
        </label>
        <input id="companyName" name="companyName" required className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="licenseNumber" className={labelClass}>
            License number (optional)
          </label>
          <input id="licenseNumber" name="licenseNumber" className={inputClass} />
        </div>
        <div>
          <label htmlFor="provinceCode" className={labelClass}>
            Province (optional)
          </label>
          <input id="provinceCode" name="provinceCode" maxLength={2} placeholder="ON" className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="licenseExpiresOn" className={labelClass}>
          License expiry (optional)
        </label>
        <input id="licenseExpiresOn" name="licenseExpiresOn" type="date" className={inputClass} />
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
        {pending ? 'Adding…' : 'Add contractor'}
      </button>
    </form>
  );
}
