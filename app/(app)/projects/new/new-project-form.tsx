'use client';

import { useActionState } from 'react';
import { createProjectAction, type NewProjectState } from './actions';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';
const sectionLabelClass = 'mt-2 text-sm font-semibold text-zinc-900';
const fieldErrorClass = 'mt-1 text-xs text-red-600';

const initialState: NewProjectState = {};

interface Taxonomy {
  id: string;
  label: string;
}

export function NewProjectForm({ taxonomies }: { taxonomies: Taxonomy[] }) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="title" className={labelClass}>
          Project title
        </label>
        <input id="title" name="title" required className={inputClass} />
        {fieldErrors.title && <p className={fieldErrorClass}>{fieldErrors.title}</p>}
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description (optional)
        </label>
        <textarea id="description" name="description" rows={3} className={inputClass} />
      </div>

      {taxonomies.length > 0 && (
        <div>
          <label htmlFor="taxonomyId" className={labelClass}>
            Project type (optional)
          </label>
          <select id="taxonomyId" name="taxonomyId" className={inputClass} defaultValue="">
            <option value="">Not set</option>
            {taxonomies.map((taxonomy) => (
              <option key={taxonomy.id} value={taxonomy.id}>
                {taxonomy.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="propertyOwnerName" className={labelClass}>
            Property owner (optional)
          </label>
          <input id="propertyOwnerName" name="propertyOwnerName" className={inputClass} />
        </div>
        <div>
          <label htmlFor="applicantName" className={labelClass}>
            Applicant (optional)
          </label>
          <input id="applicantName" name="applicantName" className={inputClass} />
        </div>
      </div>

      <h2 className={sectionLabelClass}>Client (optional)</h2>
      <div>
        <label htmlFor="clientName" className={labelClass}>
          Client name
        </label>
        <input id="clientName" name="clientName" className={inputClass} />
        {fieldErrors.clientName && <p className={fieldErrorClass}>{fieldErrors.clientName}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="clientEmail" className={labelClass}>
            Client email
          </label>
          <input id="clientEmail" name="clientEmail" type="email" className={inputClass} />
          {fieldErrors.clientEmail && <p className={fieldErrorClass}>{fieldErrors.clientEmail}</p>}
        </div>
        <div>
          <label htmlFor="clientPhone" className={labelClass}>
            Client phone
          </label>
          <input id="clientPhone" name="clientPhone" className={inputClass} />
        </div>
      </div>

      <h2 className={sectionLabelClass}>Property (optional)</h2>
      <p className="text-xs text-zinc-500">
        Fill in the full address to attach a property now, or leave every field blank to add it later.
      </p>
      <div>
        <label htmlFor="addressLine1" className={labelClass}>
          Address line 1
        </label>
        <input id="addressLine1" name="addressLine1" className={inputClass} />
        {fieldErrors.addressLine1 && <p className={fieldErrorClass}>{fieldErrors.addressLine1}</p>}
      </div>
      <div>
        <label htmlFor="addressLine2" className={labelClass}>
          Address line 2
        </label>
        <input id="addressLine2" name="addressLine2" className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="city" className={labelClass}>
            City
          </label>
          <input id="city" name="city" className={inputClass} />
        </div>
        <div>
          <label htmlFor="provinceCode" className={labelClass}>
            Province
          </label>
          <input id="provinceCode" name="provinceCode" maxLength={2} placeholder="ON" className={inputClass} />
          {fieldErrors.provinceCode && <p className={fieldErrorClass}>{fieldErrors.provinceCode}</p>}
        </div>
        <div>
          <label htmlFor="postalCode" className={labelClass}>
            Postal code
          </label>
          <input id="postalCode" name="postalCode" placeholder="M5V 2T6" className={inputClass} />
          {fieldErrors.postalCode && <p className={fieldErrorClass}>{fieldErrors.postalCode}</p>}
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
        {pending ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}
