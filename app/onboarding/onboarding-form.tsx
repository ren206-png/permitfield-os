'use client';

import { useActionState } from 'react';
import { createOrganizationAction, type OnboardingState } from './actions';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: OnboardingState = {};

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div>
        <label htmlFor="orgName" className={labelClass}>
          Organization name
        </label>
        <input id="orgName" name="orgName" required className={inputClass} placeholder="Acme Mechanical Ltd." />
        <p className="mt-1 text-xs text-zinc-500">
          The account that owns your applications, documents, and team members.
        </p>
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <p className="mb-3 text-sm font-medium text-zinc-700">First contractor / license on file</p>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="companyName" className={labelClass}>
              Company name
            </label>
            <input
              id="companyName"
              name="companyName"
              required
              className={inputClass}
              placeholder="Same as organization name, or a licensed subsidiary"
            />
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
        </div>
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
        {pending ? 'Creating…' : 'Create organization'}
      </button>
    </form>
  );
}
