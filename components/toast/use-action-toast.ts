'use client';

import { useEffect } from 'react';
import { useToast } from './toast-provider';

// Thin wiring hooks meant to be dropped into any existing
// useActionState(...)-backed form -- one line added to the component, no
// change to the Server Action itself. Both watch a *value*, not an event:
// the effect only re-fires when that value actually changes (React's
// Object.is comparison on the dependency array), so each is naturally a
// rising-edge trigger -- a `state.error` string or `state.success` boolean
// that stays the same across an unrelated re-render doesn't re-toast.
//
// Known, accepted tradeoff: if two consecutive submissions of the *same*
// form happen to return the exact same error string back-to-back, the
// second one won't re-toast, since the dependency's value didn't change
// even though it's conceptually a new event. Not worth a counter/timestamp
// to fix -- the inline `state.error` text next to the form (which every
// caller of useErrorToast already renders) still updates and remains the
// durable, accessible record either way.
export function useErrorToast(error: string | undefined) {
  const { showToast } = useToast();

  useEffect(() => {
    if (error) {
      showToast('error', error);
    }
  }, [error, showToast]);
}

export function useSuccessToast(trigger: boolean | undefined, message: string) {
  const { showToast } = useToast();

  useEffect(() => {
    if (trigger) {
      showToast('success', message);
    }
    // `message` is listed here for correctness even though every current
    // caller passes a literal string constant (so it never actually
    // changes) -- if a future caller ever passes a computed message, this
    // dependency array is already right rather than silently stale.
  }, [trigger, message, showToast]);
}
