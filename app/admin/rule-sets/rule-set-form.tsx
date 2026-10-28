'use client';

import { useActionState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { publishRuleSetAction, type RuleSetActionState } from './actions';

const initialState: RuleSetActionState = {};
const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-xs text-zinc-900';

export interface RuleSetFormRequirement {
  id: string;
  title: string;
  appliesWhen: string | null;
  included: boolean;
  conditionJson: string;
}

export function RuleSetForm({ permitTypeId, requirements }: { permitTypeId: string; requirements: RuleSetFormRequirement[] }) {
  const [state, formAction, pending] = useActionState(publishRuleSetAction, initialState);
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="permitTypeId" value={permitTypeId} />
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
        {requirements.map((r) => (
          <li key={r.id} className="space-y-2 p-3">
            <label className="flex items-start gap-2 text-sm text-zinc-900">
              <input type="checkbox" name="include" value={r.id} defaultChecked={r.included} className="mt-1" />
              <span>
                <span className="font-medium">{r.title}</span>
                {r.appliesWhen && <span className="block text-xs text-zinc-600">Source says: {r.appliesWhen}</span>}
              </span>
            </label>
            <label className="block text-xs text-zinc-600">
              Condition (JSON; blank ={' '}
              {r.appliesWhen ? 'not encoded, so the engine reports it as unknown' : 'always applies'})
              <textarea
                name={`condition:${r.id}`}
                rows={r.conditionJson ? 4 : 1}
                defaultValue={r.conditionJson}
                placeholder='{"fact": "building.strata_titled", "op": "eq", "value": true}'
                className={inputClass}
              />
            </label>
          </li>
        ))}
      </ul>
      <label className="block text-xs font-medium text-zinc-700">
        Notes for this version
        <textarea name="notes" rows={2} maxLength={2000} className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm" />
      </label>
      {state.details && state.details.length > 0 && (
        <ul className="list-disc space-y-1 rounded-md bg-rose-50 p-3 pl-6 text-xs text-rose-900">
          {state.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? 'Publishing…' : 'Publish new version'}
      </button>
    </form>
  );
}
