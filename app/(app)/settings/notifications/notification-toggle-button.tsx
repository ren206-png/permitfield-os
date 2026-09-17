'use client';

import { useActionState } from 'react';
import { toggleEmailNotificationsAction, type NotificationPreferencesActionState } from './actions';

const initialState: NotificationPreferencesActionState = {};

// One instance, submitting the OPPOSITE of the current server-rendered
// state as its hidden `nextEnabled` field -- same "one hidden field baked
// in per rendered instance, same action" shape as
// app/(app)/settings/billing/checkout-button.tsx's CheckoutButton. A
// successful submit calls revalidatePath (actions.ts), so this component
// re-renders with the new emailEnabled prop from the server rather than
// needing its own client-side optimistic state.
export function NotificationToggleButton({ emailEnabled }: { emailEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(toggleEmailNotificationsAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="nextEnabled" value={emailEnabled ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : emailEnabled ? 'Turn off' : 'Turn on'}
      </button>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
