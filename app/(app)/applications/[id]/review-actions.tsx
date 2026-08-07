'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Thin client wrapper around the two existing state-transition Route
// Handlers (confirm-review, submit) -- both already enforce their own
// preconditions server-side (e.g. "every finding reviewed" for confirm-review),
// so this component's only job is to call them and surface whatever error
// they return, never to duplicate that logic client-side.
export function ReviewActions({ applicationId, status }: { applicationId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string) {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(path, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Action failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('Action failed -- check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  if (status !== 'ready_for_review' && status !== 'documents_generated') {
    return null;
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      {status === 'ready_for_review' && (
        <>
          <p className="text-sm text-zinc-600">
            Confirm or dismiss every finding below, then confirm your review to unlock document generation.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => post(`/api/applications/${applicationId}/confirm-review`)}
            className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Confirming…' : 'Confirm review'}
          </button>
        </>
      )}

      {status === 'documents_generated' && (
        <>
          <p className="text-sm text-zinc-600">
            Once you&apos;ve filed the generated documents with the authority, mark this application submitted.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => post(`/api/applications/${applicationId}/submit`)}
            className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Marking submitted…' : 'Mark submitted'}
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
