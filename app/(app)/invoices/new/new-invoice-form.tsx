'use client';

import { useActionState, useState } from 'react';
import { createInvoiceAction, type NewInvoiceState } from './actions';

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  title: string;
}

interface EstimateOption {
  id: string;
  label: string;
}

interface LineItemRow {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
}

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: NewInvoiceState = {};

let nextRowKey = 1;
function emptyRow(): LineItemRow {
  return { key: nextRowKey++, description: '', quantity: '1', unitPrice: '', discountPercent: '' };
}

// Mirrors app/(app)/estimates/new/new-estimate-form.tsx's shape exactly
// (same dynamic line-item row state, same field names for
// parseLineItems() to read on the server), plus an optional "source
// estimate" select for metadata-only traceability.
export function NewInvoiceForm({
  clients,
  projects,
  estimates,
}: {
  clients: Client[];
  projects: Project[];
  estimates: EstimateOption[];
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, initialState);
  const [rows, setRows] = useState<LineItemRow[]>([emptyRow()]);

  function updateRow(key: number, field: keyof Omit<LineItemRow, 'key'>, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div>
        <label htmlFor="clientId" className={labelClass}>
          Client
        </label>
        <select id="clientId" name="clientId" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Select a client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {projects.length > 0 && (
        <div>
          <label htmlFor="projectId" className={labelClass}>
            Project (optional)
          </label>
          <select id="projectId" name="projectId" className={inputClass} defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {estimates.length > 0 && (
        <div>
          <label htmlFor="sourceEstimateId" className={labelClass}>
            Source estimate (optional)
          </label>
          <select id="sourceEstimateId" name="sourceEstimateId" className={inputClass} defaultValue="">
            <option value="">Not created from an estimate</option>
            {estimates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            For traceability only — line items are not copied automatically. Re-enter them below.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="dueDate" className={labelClass}>
          Due date (optional)
        </label>
        <input id="dueDate" name="dueDate" type="date" className={inputClass} />
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <h2 className="text-sm font-medium text-zinc-900">Line items</h2>
        <div className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-1 gap-2 rounded-md border border-zinc-200 p-3 sm:grid-cols-12">
              <input
                name="description"
                placeholder="Description"
                className={`${inputClass} sm:col-span-5`}
                value={row.description}
                onChange={(e) => updateRow(row.key, 'description', e.target.value)}
              />
              <input
                name="quantity"
                placeholder="Qty"
                inputMode="decimal"
                className={`${inputClass} sm:col-span-2`}
                value={row.quantity}
                onChange={(e) => updateRow(row.key, 'quantity', e.target.value)}
              />
              <input
                name="unitPrice"
                placeholder="Unit price"
                inputMode="decimal"
                className={`${inputClass} sm:col-span-2`}
                value={row.unitPrice}
                onChange={(e) => updateRow(row.key, 'unitPrice', e.target.value)}
              />
              <input
                name="discountPercent"
                placeholder="Discount %"
                inputMode="decimal"
                className={`${inputClass} sm:col-span-2`}
                value={row.discountPercent}
                onChange={(e) => updateRow(row.key, 'discountPercent', e.target.value)}
              />
              <button
                type="button"
                onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                className="text-xs font-medium text-red-600 hover:underline sm:col-span-1"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          className="mt-3 text-sm font-medium text-zinc-900 underline"
        >
          + Add line item
        </button>
      </div>

      <div>
        <label htmlFor="scopeNotes" className={labelClass}>
          Scope notes (optional)
        </label>
        <textarea id="scopeNotes" name="scopeNotes" rows={3} className={inputClass} />
      </div>
      <div>
        <label htmlFor="terms" className={labelClass}>
          Terms (optional)
        </label>
        <textarea id="terms" name="terms" rows={2} className={inputClass} />
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
        {pending ? 'Creating…' : 'Create draft invoice'}
      </button>
    </form>
  );
}
