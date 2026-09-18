'use client';

import { useActionState } from 'react';
import { upsertTaxProfileAction, type TaxProfileActionState } from './actions';
import type { OrgTaxProfileFullRecord } from '@/lib/quotes-payments/org-tax-profile';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: TaxProfileActionState = {};

export function TaxProfileForm({ profile }: { profile: OrgTaxProfileFullRecord | null }) {
  const [state, formAction, pending] = useActionState(upsertTaxProfileAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div>
        <label htmlFor="legalName" className={labelClass}>
          Legal name
        </label>
        <input id="legalName" name="legalName" required className={inputClass} defaultValue={profile?.legalName ?? ''} />
      </div>

      <div>
        <label htmlFor="tradingName" className={labelClass}>
          Trading name (optional)
        </label>
        <input id="tradingName" name="tradingName" className={inputClass} defaultValue={profile?.tradingName ?? ''} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="addressLine1" className={labelClass}>
            Address line 1
          </label>
          <input
            id="addressLine1"
            name="addressLine1"
            required
            className={inputClass}
            defaultValue={profile?.addressLine1 ?? ''}
          />
        </div>
        <div>
          <label htmlFor="addressLine2" className={labelClass}>
            Address line 2 (optional)
          </label>
          <input id="addressLine2" name="addressLine2" className={inputClass} defaultValue={profile?.addressLine2 ?? ''} />
        </div>
        <div>
          <label htmlFor="city" className={labelClass}>
            City
          </label>
          <input id="city" name="city" required className={inputClass} defaultValue={profile?.city ?? ''} />
        </div>
        <div>
          <label htmlFor="provinceCode" className={labelClass}>
            Province code
          </label>
          <input
            id="provinceCode"
            name="provinceCode"
            required
            maxLength={2}
            placeholder="ON"
            className={inputClass}
            defaultValue={profile?.provinceCode ?? ''}
          />
        </div>
        <div>
          <label htmlFor="postalCode" className={labelClass}>
            Postal code
          </label>
          <input id="postalCode" name="postalCode" required className={inputClass} defaultValue={profile?.postalCode ?? ''} />
        </div>
        <div>
          <label htmlFor="timezone" className={labelClass}>
            Timezone (optional)
          </label>
          <input
            id="timezone"
            name="timezone"
            placeholder="America/Toronto"
            className={inputClass}
            defaultValue={profile?.timezone ?? ''}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invoiceContactName" className={labelClass}>
            Invoice contact name (optional)
          </label>
          <input
            id="invoiceContactName"
            name="invoiceContactName"
            className={inputClass}
            defaultValue={profile?.invoiceContactName ?? ''}
          />
        </div>
        <div>
          <label htmlFor="invoiceContactEmail" className={labelClass}>
            Invoice contact email (optional)
          </label>
          <input
            id="invoiceContactEmail"
            name="invoiceContactEmail"
            type="email"
            className={inputClass}
            defaultValue={profile?.invoiceContactEmail ?? ''}
          />
        </div>
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <h2 className="text-sm font-medium text-zinc-900">GST/HST</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="gstHstStatus" className={labelClass}>
              Status
            </label>
            <select id="gstHstStatus" name="gstHstStatus" className={inputClass} defaultValue={profile?.gstHstStatus ?? 'unknown'}>
              <option value="unknown">Unknown</option>
              <option value="unregistered">Unregistered</option>
              <option value="registered">Registered</option>
            </select>
          </div>
          <div>
            <label htmlFor="gstHstNumber" className={labelClass}>
              GST/HST number
            </label>
            <input id="gstHstNumber" name="gstHstNumber" className={inputClass} defaultValue={profile?.gstHstNumber ?? ''} />
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <h2 className="text-sm font-medium text-zinc-900">BC PST</h2>
        <p className="mt-1 text-xs text-zinc-500">Tracked independently of GST/HST -- never inferred from it.</p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bcPstStatus" className={labelClass}>
              Status
            </label>
            <select id="bcPstStatus" name="bcPstStatus" className={inputClass} defaultValue={profile?.bcPstStatus ?? 'unknown'}>
              <option value="unknown">Unknown</option>
              <option value="unregistered">Unregistered</option>
              <option value="registered">Registered</option>
            </select>
          </div>
          <div>
            <label htmlFor="bcPstNumber" className={labelClass}>
              BC PST number
            </label>
            <input id="bcPstNumber" name="bcPstNumber" className={inputClass} defaultValue={profile?.bcPstNumber ?? ''} />
          </div>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-sm text-green-700">Tax profile saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save tax profile'}
      </button>
    </form>
  );
}
