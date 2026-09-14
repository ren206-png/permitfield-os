'use client';

import { useActionState, useState } from 'react';
import { createChangeOrderAction, type NewChangeOrderState } from './actions';

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

const initialState: NewChangeOrderState = {};

let nextRowKey = 1;
function emptyRow(): LineItemRow {
  return { key: nextRowKey++, description: '', quantity: '1', unitPrice: '', discountPercent: '' };
}

/** Mirrors app/(app)/invoices/new/new-invoice-form.tsx's dynamic line-item row state and field names exactly (parseLineItems() on the server reads the same repeated field names). Unlike that form, the client is not picked here -- it is re-derived server-side from the required sourceInvoiceId, so this form only asks for a title/description plus the delta line items. */
export function NewChangeOrderForm({ sourceInvoiceId }: { sourceInvoiceId: string }) {
  const [state, formAction, pending] = useActionState(createChangeOrderAction, initialState);
  const [rows, setRows] = useState<LineItemRow[]>([emptyRow()]);

  function updateRow(key: number, field: keyof Omit<LineItemRow, 'key'>, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="sourceInvoiceId" value={sourceInvoiceId} />

      <div>
        <label htmlFor="title" className={labelClass}>
          Title
        </label>
        <input id="title" name="title" required placeholder="e.g. Additional excavation work" className={inputClass} />
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description (optional)
        </label>
        <textarea id="description" name="description" rows={3} className={inputClass} />
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <h2 className="text-sm font-medium text-zinc-900">Delta line items</h2>
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
        {pending ? 'Creating…' : 'Create draft change order'}
      </button>
    </form>
  );
}
