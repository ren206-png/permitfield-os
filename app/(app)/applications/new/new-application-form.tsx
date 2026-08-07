'use client';

import { useActionState, useMemo, useState } from 'react';
import { createApplicationAction, type NewApplicationState } from './actions';
import { CoverageBadge } from '@/components/coverage-badge';

interface Jurisdiction {
  id: string;
  municipality: string;
  province_code: string;
  coverage_level: string;
}

interface PermitType {
  id: string;
  title: string;
  jurisdiction_id: string;
}

interface Contractor {
  id: string;
  company_name: string;
}

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: NewApplicationState = {};

export function NewApplicationForm({
  jurisdictions,
  permitTypes,
  contractors,
}: {
  jurisdictions: Jurisdiction[];
  permitTypes: PermitType[];
  contractors: Contractor[];
}) {
  const [state, formAction, pending] = useActionState(createApplicationAction, initialState);
  const [jurisdictionId, setJurisdictionId] = useState('');

  const selectedJurisdiction = useMemo(
    () => jurisdictions.find((j) => j.id === jurisdictionId) ?? null,
    [jurisdictions, jurisdictionId]
  );

  // Cascading select: permit types are filtered client-side by the chosen
  // jurisdiction (both lists are small reference data, already fetched in
  // full server-side -- no need for a round trip per jurisdiction change).
  const permitTypesForJurisdiction = useMemo(
    () => permitTypes.filter((pt) => pt.jurisdiction_id === jurisdictionId),
    [permitTypes, jurisdictionId]
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div>
        <label htmlFor="jurisdictionSelect" className={labelClass}>
          Jurisdiction
        </label>
        <select
          id="jurisdictionSelect"
          className={inputClass}
          value={jurisdictionId}
          onChange={(e) => setJurisdictionId(e.target.value)}
        >
          <option value="">Select a jurisdiction…</option>
          {jurisdictions.map((j) => (
            <option key={j.id} value={j.id}>
              {j.municipality}, {j.province_code}
            </option>
          ))}
        </select>
      </div>

      {selectedJurisdiction && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600">Coverage:</span>
          <CoverageBadge coverageLevel={selectedJurisdiction.coverage_level} />
        </div>
      )}

      {selectedJurisdiction && permitTypesForJurisdiction.length === 0 && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600">
          No permit types are set up yet for {selectedJurisdiction.municipality}, {selectedJurisdiction.province_code}
          . This jurisdiction is listed but not yet ready to file through PermitField -- check back soon, or contact
          the authority having jurisdiction directly.
        </p>
      )}

      <div>
        <label htmlFor="permitTypeId" className={labelClass}>
          Permit type
        </label>
        <select
          id="permitTypeId"
          name="permitTypeId"
          required
          className={inputClass}
          disabled={!jurisdictionId || permitTypesForJurisdiction.length === 0}
          defaultValue=""
        >
          <option value="" disabled>
            {jurisdictionId ? 'Select a permit type…' : 'Select a jurisdiction first'}
          </option>
          {permitTypesForJurisdiction.map((pt) => (
            <option key={pt.id} value={pt.id}>
              {pt.title}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <label htmlFor="contractorId" className={labelClass}>
          Contractor
        </label>
        <select id="contractorId" name="contractorId" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Select a contractor…
          </option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="projectTitle" className={labelClass}>
          Project title
        </label>
        <input
          id="projectTitle"
          name="projectTitle"
          required
          className={inputClass}
          placeholder="200A service upgrade -- 123 Main St"
        />
      </div>

      <div>
        <label htmlFor="projectAddress" className={labelClass}>
          Project address
        </label>
        <input id="projectAddress" name="projectAddress" required className={inputClass} />
      </div>

      <div>
        <label htmlFor="estimatedJobValue" className={labelClass}>
          Estimated job value (optional)
        </label>
        <input
          id="estimatedJobValue"
          name="estimatedJobValue"
          inputMode="decimal"
          className={inputClass}
          placeholder="12500.00"
        />
        <p className="mt-1 text-xs text-zinc-500">Dollar amount, CAD. Leave blank if not yet known.</p>
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
        {pending ? 'Creating…' : 'Create application'}
      </button>
    </form>
  );
}
