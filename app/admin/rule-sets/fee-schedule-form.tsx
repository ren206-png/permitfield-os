'use client';

import { useActionState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { publishFeeScheduleAction, type RuleSetActionState } from './actions';

// Gate 6.5: publish a fee schedule version. The schedule is JSON in the
// shape of lib/fees/schedule.ts (amounts in cents); it must cite a
// published source revision of the same municipality.

const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900';
const EXAMPLE = JSON.stringify(
  {
    components: [
      { kind: 'rate', label: 'Building permit', category: 'fee', input: { source: 'fact', fact: 'project.floor_area', unit: 'm2' }, rate_minor: 1585, per: 1, min_minor: 20000 },
      { kind: 'flat', label: 'Application fee', category: 'fee', amount_minor: 15000 },
    ],
    exclusions: ['GST', 'Development charges'],
    assumptions: [],
  },
  null,
  2
);

export function FeeScheduleForm({
  permitTypeId,
  revisions,
  current,
}: {
  permitTypeId: string;
  revisions: { id: string; label: string }[];
  current: { parameters: unknown; currency: string; roundingRule: string } | null;
}) {
  const [state, action, pending] = useActionState(publishFeeScheduleAction, {} as RuleSetActionState);
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
  if (revisions.length === 0) {
    return <p className="text-sm text-zinc-500">Publish the city&apos;s fee page as a source revision first (Sources), then come back.</p>;
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="permitTypeId" value={permitTypeId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-zinc-700 sm:col-span-2">
          Official source (published revision)
          <select name="sourceRevisionId" required className={inputClass}>
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-700">
          Currency
          <input name="currency" defaultValue={current?.currency ?? 'CAD'} required maxLength={3} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-zinc-700">
          Rounding (as the schedule states)
          <select name="roundingRule" defaultValue={current?.roundingRule ?? 'half_up_to_cent'} className={inputClass}>
            <option value="half_up_to_cent">Nearest cent (half up)</option>
            <option value="half_even_to_cent">Nearest cent (half even)</option>
            <option value="up_to_dollar">Up to the dollar</option>
            <option value="down_to_dollar">Down to the dollar</option>
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-700">
          Effective from
          <input type="date" name="effectiveFrom" required className={inputClass} />
        </label>
        <label className="text-xs font-medium text-zinc-700">
          Effective to (blank = open)
          <input type="date" name="effectiveTo" className={inputClass} />
        </label>
      </div>
      <label className="block text-xs font-medium text-zinc-700">
        Schedule (JSON, amounts in cents)
        <textarea
          name="parameters"
          required
          rows={12}
          defaultValue={current ? JSON.stringify(current.parameters, null, 2) : EXAMPLE}
          className={`${inputClass} font-mono text-xs`}
        />
      </label>
      {state.details && (
        <ul className="list-disc space-y-1 rounded-md bg-rose-50 p-3 pl-6 text-xs text-rose-900">
          {state.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
        {pending ? 'Publishing…' : 'Publish fee schedule version'}
      </button>
    </form>
  );
}
