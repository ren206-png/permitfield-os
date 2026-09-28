'use client';

import { useActionState, useState } from 'react';
import {
  addChecklistItemAction,
  addSuggestedItemsAction,
  deleteChecklistItemAction,
  overrideReadinessAction,
  setChecklistItemStatusAction,
  transitionPermitStatusAction,
  type ReadinessActionState,
} from './readiness-actions';

const initialState: ReadinessActionState = {};

const primaryButton =
  'rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60';
const linkButton = 'text-xs font-medium text-zinc-700 underline underline-offset-2 disabled:opacity-60';
const input = 'rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900';

function Result({ state }: { state: ReadinessActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-1 text-xs text-red-600">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="mt-1 text-xs text-emerald-700">
        {state.message}
      </p>
    );
  }
  return null;
}

export function PermitStatusForm({ applicationId, options }: { applicationId: string; options: { value: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(transitionPermitStatusAction, initialState);
  const [toStatus, setToStatus] = useState(options[0]?.value ?? '');
  const [reason, setReason] = useState('');
  return (
    <form action={formAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-zinc-700">
          Move to
          <select name="toStatus" value={toStatus} onChange={(event) => setToStatus(event.target.value)} className={input}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
          Note (optional)
          <input name="reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={input} />
        </label>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? 'Saving…' : 'Update status'}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ChecklistItemActions({
  applicationId,
  itemId,
  status,
  canDelete,
}: {
  applicationId: string;
  itemId: string;
  status: 'pending' | 'complete' | 'rejected';
  canDelete: boolean;
}) {
  const [state, formAction, pending] = useActionState(setChecklistItemStatusAction, initialState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteChecklistItemAction, initialState);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-3">
        {status !== 'complete' && (
          <form action={formAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="status" value="complete" />
            <button type="submit" disabled={pending} className={linkButton}>
              Mark complete
            </button>
          </form>
        )}
        {status === 'pending' && (
          <button type="button" className={linkButton} onClick={() => setRejecting((v) => !v)}>
            Reject
          </button>
        )}
        {status !== 'pending' && (
          <form action={formAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="status" value="pending" />
            <button type="submit" disabled={pending} className={linkButton}>
              Reopen
            </button>
          </form>
        )}
        {canDelete && (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (!window.confirm('Delete this checklist item?')) event.preventDefault();
            }}
          >
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="itemId" value={itemId} />
            <button type="submit" disabled={deleting} className="text-xs font-medium text-red-600 underline underline-offset-2">
              Delete
            </button>
          </form>
        )}
      </div>
      {rejecting && status === 'pending' && (
        <form action={formAction} className="flex w-full max-w-sm gap-2">
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="status" value="rejected" />
          <input
            name="rejectionReason"
            required
            maxLength={500}
            placeholder="Why?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${input} min-w-0 flex-1 py-1 text-xs`}
          />
          <button type="submit" disabled={pending} className={linkButton}>
            Save
          </button>
        </form>
      )}
      <Result state={state} />
      <Result state={deleteState} />
    </div>
  );
}

const EMPTY_ITEM = { title: '', description: '', responsibleParty: '', dueDate: '', isRequired: true };

export function AddChecklistItemForm({ applicationId }: { applicationId: string }) {
  const [fields, setFields] = useState(EMPTY_ITEM);
  // Clears the form only once the item is saved; on an error the typed
  // values stay (the inputs are controlled, so React's post-action reset
  // doesn't wipe them either).
  const [state, formAction, pending] = useActionState(async (prev: ReadinessActionState, formData: FormData) => {
    const result = await addChecklistItemAction(prev, formData);
    if (!result.error) setFields(EMPTY_ITEM);
    return result;
  }, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input
        name="title"
        required
        maxLength={200}
        placeholder="What needs to be done"
        value={fields.title}
        onChange={(event) => setFields({ ...fields, title: event.target.value })}
        className={input}
      />
      <input
        name="description"
        maxLength={1000}
        placeholder="Details (optional)"
        value={fields.description}
        onChange={(event) => setFields({ ...fields, description: event.target.value })}
        className={input}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="responsibleParty"
          maxLength={200}
          placeholder="Who (optional)"
          value={fields.responsibleParty}
          onChange={(event) => setFields({ ...fields, responsibleParty: event.target.value })}
          className={`${input} min-w-0 flex-1`}
        />
        <input
          name="dueDate"
          type="date"
          value={fields.dueDate}
          onChange={(event) => setFields({ ...fields, dueDate: event.target.value })}
          className={input}
          aria-label="Due date (optional)"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-700">
        <input
          type="checkbox"
          name="isRequired"
          checked={fields.isRequired}
          onChange={(event) => setFields({ ...fields, isRequired: event.target.checked })}
        />
        Required before the application is ready to submit
      </label>
      <button type="submit" disabled={pending} className={`${primaryButton} self-start`}>
        {pending ? 'Adding…' : 'Add item'}
      </button>
      <Result state={state} />
    </form>
  );
}

export function AddSuggestedItemsButton({ applicationId }: { applicationId: string }) {
  const [state, formAction, pending] = useActionState(addSuggestedItemsAction, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <button type="submit" disabled={pending} className={linkButton}>
        {pending ? 'Adding…' : 'Add suggested items'}
      </button>
      <Result state={state} />
    </form>
  );
}

export function OverrideReadinessForm({ applicationId, minLength }: { applicationId: string; minLength: number }) {
  const [state, formAction, pending] = useActionState(overrideReadinessAction, initialState);
  const [reason, setReason] = useState('');
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <textarea
        name="reason"
        required
        minLength={minLength}
        maxLength={1000}
        rows={2}
        placeholder={`Why this can go ahead without the remaining items (at least ${minLength} characters)`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className={input}
      />
      <button type="submit" disabled={pending || reason.trim().length < minLength} className={`${primaryButton} self-start`}>
        {pending ? 'Recording…' : 'Record override'}
      </button>
      <Result state={state} />
    </form>
  );
}
