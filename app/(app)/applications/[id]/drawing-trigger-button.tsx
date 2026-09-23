'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Posts to app/api/applications/[id]/drawings/[documentId]/review/route.ts,
// which sends 'permit/application.drawing_review_ready' and returns 202
// immediately -- the actual review (lib/inngest/functions/drawing-review.ts)
// runs asynchronously, same "fire and let the user refresh later" shape as
// document-upload.tsx's own "start AI extraction" checkbox. No polling here
// for the same reason that component has none.
//
// coverageLevel !== 'verified' disables the button rather than letting the
// click go through: drawing-review.ts's own two-gate skip logic
// (isDrawingReviewEnabled() && coverageLevel === 'verified') would otherwise
// silently no-op the request into a reviewed:false skip event with no
// drawing_reviews row for this UI to ever surface -- mirrors findings-list.tsx's
// own coverage-aware empty-state reasoning, applied before the click instead
// of after.
export function DrawingTriggerButton({
  applicationId,
  documentId,
  coverageLevel,
}: {
  applicationId: string;
  documentId: string;
  coverageLevel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  if (coverageLevel !== 'verified') {
    return (
      <p className="text-sm text-zinc-500">
        Drawing review is not available for this jurisdiction. This jurisdiction is{' '}
        {coverageLevel === 'assisted' ? '"Assisted — AI audit off"' : '"Listed only — not yet covered"'}, so
        starting a review here would not run against a coverage-checked corpus -- an automated review would
        silently not run. Verify drawing requirements directly with the authority having jurisdiction.
      </p>
    );
  }

  async function trigger() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/drawings/${documentId}/review`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Failed to start drawing review.');
        return;
      }
      setStarted(true);
      router.refresh();
    } catch {
      setError('Failed to start drawing review -- check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending || started}
        onClick={trigger}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Starting…' : started ? 'Review started' : 'Start drawing review'}
      </button>
      {started && !error && (
        <p className="mt-2 text-sm text-zinc-500">
          Review is running in the background -- refresh this page in a bit to see findings.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
