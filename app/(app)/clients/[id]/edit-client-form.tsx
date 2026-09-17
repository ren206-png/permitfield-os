'use client';

import { useActionState, useEffect } from 'react';
import { updateClientAction, type EditClientState } from './actions';
import { useErrorToast } from '@/components/toast/use-action-toast';
import { useToast } from '@/components/toast/toast-provider';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const labelClass = 'mb-1 block text-sm font-medium text-zinc-700';

const initialState: EditClientState = {};

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

// Toggled inline on the detail page rather than a separate /clients/[id]/edit
// route -- there's little enough state here (4 fields) that a second route
// would just be this same form with extra navigation, and the "view" state
// underneath doesn't need to unmount while editing.
export function EditClientForm({ client, onDone }: { client: Client; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateClientAction, initialState);
  const { showToast } = useToast();
  useErrorToast(state.error);

  // Notifies the parent (which owns the view/edit toggle) rather than
  // setting any state of this component's own -- this effect's only job is
  // synchronizing "the action succeeded" out to the external owner of
  // edit-mode, not updating local state, so it doesn't fall under the
  // "avoid setState-in-effect" rule that applies to a component's own state.
  useEffect(() => {
    if (state.success) {
      showToast('success', 'Client updated.');
      onDone();
    }
  }, [state.success, onDone, showToast]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={client.id} />

      <div>
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input id="name" name="name" required defaultValue={client.name} className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email (optional)
          </label>
          <input id="email" name="email" type="email" defaultValue={client.email ?? ''} className={inputClass} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone (optional)
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={client.phone ?? ''} className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes (optional)
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={client.notes ?? ''} className={inputClass} />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
