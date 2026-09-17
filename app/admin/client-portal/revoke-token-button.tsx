'use client';

import { useActionState, useRef } from 'react';
import { revokeTokenAction, type RevokeTokenState } from './actions';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { ConfirmDialog, type ConfirmDialogHandle } from '@/components/confirm-dialog';

const initialState: RevokeTokenState = {};

export function RevokeTokenButton({ tokenId }: { tokenId: string }) {
  const [state, formAction, pending] = useActionState(revokeTokenAction, initialState);
  useErrorToast(state.error);
  useSuccessToast(state.revoked, 'Token revoked.');

  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  if (state.revoked) {
    return <span className="text-xs text-zinc-500">Revoked</span>;
  }

  // Button is type="button", not type="submit" -- the confirm dialog
  // decides whether the form's real submit (revokeTokenAction) ever
  // happens, via requestSubmit() below. See confirm-dialog.tsx's own header
  // comment for why this is the one existing one-click destructive action
  // in the app that this component was built for.
  async function handleClick() {
    const confirmed = await dialogRef.current?.open();
    if (confirmed) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form ref={formRef} action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="tokenId" value={tokenId} />
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      <ConfirmDialog
        ref={dialogRef}
        title="Revoke this client portal token?"
        message="The recipient will immediately lose access. This cannot be undone -- a new token would need to be issued separately."
        confirmLabel="Revoke"
      />
    </form>
  );
}
