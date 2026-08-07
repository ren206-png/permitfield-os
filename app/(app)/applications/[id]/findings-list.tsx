'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Finding {
  id: string;
  kind: string;
  severity: string;
  issue: string;
  action_required: string;
  confidence: number;
  review_status: string;
  codeChunk: { code_section: string; source_url: string } | null;
}

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

// coverageLevel drives the empty-state copy only -- never the findings
// themselves, which always come straight from the DB. Wording mirrors
// components/coverage-badge.tsx's safety rule: an empty findings list on an
// 'assisted'/'listed' jurisdiction must never read as "nothing wrong was
// found," because no AI review actually ran against a coverage-checked
// corpus for those tiers.
export function FindingsList({
  applicationId,
  findings,
  coverageLevel,
}: {
  applicationId: string;
  findings: Finding[];
  coverageLevel: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(findingId: string, action: 'confirm' | 'dismiss') {
    setError(null);
    setPendingId(findingId);
    try {
      const res = await fetch(`/api/applications/${applicationId}/findings/${findingId}/review`, {
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
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600">
        {coverageLevel === 'verified' ? (
          <p>No audit findings yet. Findings appear here once AI extraction and audit have run.</p>
        ) : (
          <p>
            No AI audit findings for this application. This jurisdiction is{' '}
            {coverageLevel === 'assisted' ? '"Assisted — AI audit off"' : '"Listed only — not yet covered"'}, so no
            automated code review runs against it -- an empty list here means no review happened, not a clean
            result. Verify requirements directly with the authority having jurisdiction.
          </p>
        )}
      </div>
    );
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
              {f.codeChunk && (
                <a
                  href={f.codeChunk.source_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-block text-xs text-zinc-500 underline hover:text-zinc-700"
                >
                  Citation: {f.codeChunk.code_section}
                </a>
              )}
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
