'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

// No `confirm()` calls exist anywhere in this codebase (this app's own
// UX-audit finding) -- every destructive Server Action (today: just
// app/admin/client-portal/revoke-token-button.tsx's "Revoke", the only
// one-click irreversible-from-the-UI action in the app; there are no
// `.delete()` calls at all -- everything else follows the "archive via
// archived_at, never delete" discipline documented throughout
// supabase/migrations/) fires immediately on click with no way to back out
// of a misclick. This is the reusable guard for that: an imperative-handle
// wrapper around the native <dialog> element (showModal()/close()) rather
// than a hand-rolled overlay + focus trap, since <dialog> already gives us
// focus trapping, Escape-to-cancel, and top-layer stacking natively.
//
// Usage: render <ConfirmDialog ref={dialogRef} .../> once alongside the
// trigger, then from a plain onClick handler:
//   const confirmed = await dialogRef.current?.open();
//   if (confirmed) formRef.current?.requestSubmit();
// (the caller keeps its own <form action={someServerAction}> for the real
// submit -- this component only decides *whether* that submit happens, it
// has no knowledge of what it's confirming.)
export interface ConfirmDialogHandle {
  open: () => Promise<boolean>;
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (the default -- this
   * component exists specifically for those) vs. the neutral dark button
   * for a merely-disruptive-but-not-destructive confirmation. */
  variant?: 'destructive' | 'neutral';
}

export const ConfirmDialog = forwardRef<ConfirmDialogHandle, ConfirmDialogProps>(function ConfirmDialog(
  { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'destructive' },
  ref
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Bridges the imperative open()'s Promise to the two button clicks (and
  // the native `cancel` event) below -- there's exactly one pending
  // resolver at a time since open() can't usefully be called again before
  // the dialog it already opened has been closed.
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  useImperativeHandle(ref, () => ({
    open: () =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        dialogRef.current?.showModal();
      }),
  }));

  function respond(confirmed: boolean) {
    dialogRef.current?.close();
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
  }

  return (
    <dialog
      ref={dialogRef}
      className="rounded-lg border border-zinc-200 bg-white p-0 shadow-lg backdrop:bg-zinc-900/40"
      onCancel={(event) => {
        // The Escape key fires the dialog's native `cancel` event, which
        // (unless prevented) closes it with no way for us to observe that
        // it happened -- prevent the default close so respond(false) is
        // the single place close() is called, keeping resolveRef in sync.
        event.preventDefault();
        respond(false);
      }}
    >
      <div className="w-80 p-5 sm:w-96">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        <p className="mt-2 text-sm text-zinc-600">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => respond(false)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-colors ${
              variant === 'destructive' ? 'bg-red-600 hover:bg-red-700' : 'bg-zinc-900 hover:bg-zinc-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
});
