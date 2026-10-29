'use client';

import { useActionState, useState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { FACT_KEYS, type FactKey } from '@/lib/requirements/rules/fact-keys';
import {
  confirmFactAction,
  enterFactAction,
  proposeFactsFromDocumentsAction,
  rejectFactAction,
  type FactActionState,
} from './actions';

const initialState: FactActionState = {};
const smallButton =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900';

function useResultToasts(state: FactActionState) {
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
}

export function ReviewFactButtons({ applicationId, factId }: { applicationId: string; factId: string }) {
  const [confirmState, confirm, confirming] = useActionState(confirmFactAction, initialState);
  const [rejectState, reject, rejecting] = useActionState(rejectFactAction, initialState);
  useResultToasts(confirmState);
  useResultToasts(rejectState);
  return (
    <div className="mt-2 flex gap-2">
      <form action={confirm}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="factId" value={factId} />
        <button
          type="submit"
          disabled={confirming || rejecting}
          className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {confirming ? 'Saving…' : 'Confirm'}
        </button>
      </form>
      <form action={reject}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="factId" value={factId} />
        <button type="submit" disabled={confirming || rejecting} className={smallButton}>
          {rejecting ? 'Saving…' : 'Wrong'}
        </button>
      </form>
    </div>
  );
}

export function ProposeFromDocumentsButton({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(proposeFactsFromDocumentsAction, initialState);
  useResultToasts(state);
  return (
    <form action={action}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Reading…' : 'Suggest facts from my documents'}
      </button>
    </form>
  );
}

export function EnterFactForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(enterFactAction, initialState);
  const [key, setKey] = useState<FactKey>('building.strata_titled');
  useResultToasts(state);
  const def = FACT_KEYS[key];
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <label className="text-xs font-medium text-zinc-700">
        Add or correct a fact
        <select name="factKey" value={key} onChange={(e) => setKey(e.target.value as FactKey)} className={inputClass}>
          {(Object.keys(FACT_KEYS) as FactKey[]).map((k) => (
            <option key={k} value={k}>
              {FACT_KEYS[k].label}
            </option>
          ))}
        </select>
      </label>
      {def.kind === 'boolean' ? (
        <select name="value" defaultValue="" required className={inputClass} aria-label="Value">
          <option value="" disabled>
            Choose…
          </option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : def.kind === 'enum' ? (
        <select name="value" defaultValue="" required className={inputClass} aria-label="Value">
          <option value="" disabled>
            Choose…
          </option>
          {('values' in def ? def.values : []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input name="value" required inputMode="decimal" placeholder={'hint' in def ? def.hint : ''} className={inputClass} aria-label="Value" />
      )}
      <button type="submit" disabled={pending} className={`${smallButton} self-start`}>
        {pending ? 'Saving…' : 'Save fact'}
      </button>
    </form>
  );
}
