'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DrawingFinding {
  id: string;
  kind: string;
  severity: string;
  issue: string;
  action_required: string;
  confidence: number;
  review_status: string;
  sourcePage: number | null;
  codeChunk: { code_section: string; source_url: string } | null;
}

// Byte-for-byte the same severity/kind label maps and layout as
// findings-list.tsx -- drawing_findings reuses audit_findings' own
// finding_kind/finding_severity/finding_review_status enums (20260806000045's
// header comment), so there is no new vocabulary to render here, only a
// second citation (sourcePage, the drawing-specific "where on the sheet"
// evidence audit_findings has no equivalent of).
const SEVERITY_CLASSES: Record<string, string> = {
  critical: 'border-red-300 bg-red-50',
  warning: 'border-amber-300 bg-amber-50',
  info: 'border-zinc-200 bg-zinc-50',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const KIND_LABELS: Record<string, string> = {
  passed_check: 'Passed check',
  missing_document: 'Missing document',
  code_conflict: 'Code conflict',
};

export function DrawingFindingsList({
  applicationId,
  findings,
}: {
  applicationId: string;
  findings: DrawingFinding[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(findingId: string, action: 'confirm' | 'dismiss') {
    setError(null);
    setPendingId(findingId);
    try {
      const res = await fetch(`/api/applications/${applicationId}/drawing-findings/${findingId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Failed to update finding.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to update finding -- check your connection and try again.');
    } finally {
      setPendingId(null);
    }
  }

  if (findings.length === 0) {
    return <p className="text-sm text-zinc-500">No findings from the latest drawing review.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {findings.map((f) => (
        <div key={f.id} className={`rounded-lg border p-4 ${SEVERITY_CLASSES[f.severity] ?? 'border-zinc-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <span>{SEVERITY_LABELS[f.severity] ?? f.severity}</span>
                <span>·</span>
                <span>{KIND_LABELS[f.kind] ?? f.kind}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-zinc-900">{f.issue}</p>
              <p className="mt-1 text-sm text-zinc-700">{f.action_required}</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {f.codeChunk && (
                  <a
                    href={f.codeChunk.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-block text-xs text-zinc-500 underline hover:text-zinc-700"
                  >
                    Citation: {f.codeChunk.code_section}
                  </a>
                )}
                {f.sourcePage != null && <span className="text-xs text-zinc-500">Sheet page {f.sourcePage}</span>}
              </div>
              <p className="mt-1 text-xs text-zinc-400">Confidence: {Math.round(f.confidence * 100)}%</p>
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-2">
              {f.review_status === 'unverified' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pendingId === f.id}
                    onClick={() => review(f.id, 'confirm')}
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={pendingId === f.id}
                    onClick={() => review(f.id, 'dismiss')}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <span className="inline-block rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-700 whitespace-nowrap">
                  {f.review_status === 'confirmed' ? 'Confirmed' : 'Dismissed'}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
