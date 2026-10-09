'use client';

import { useState } from 'react';
import type { PortalAnswer } from '@/lib/pdf/portal-answers';

// The portal answer sheet (lib/pdf/portal-answers.ts): each answer with its
// own Copy button, for pasting into the authority's online application.
export function PortalAnswers({
  answers,
  allText,
  authorityName,
}: {
  answers: PortalAnswer[];
  /** Every answer as "Label: value" lines (portalAnswersText), built on the server. */
  allText: string;
  authorityName: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(key: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => setCopied(key));
  }

  return (
    <div className="rounded-md border border-zinc-200 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-800">Answers for {authorityName}&apos;s online application</p>
        <button
          type="button"
          onClick={() => copy('all', allText)}
          className="text-xs font-medium text-zinc-900 underline underline-offset-2"
        >
          {copied === 'all' ? 'Copied' : 'Copy all'}
        </button>
      </div>
      <dl className="mt-2 divide-y divide-zinc-100 text-xs">
        {answers.map((answer) => (
          <div key={answer.label} className="flex items-start justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <dt className="text-zinc-500">{answer.label}</dt>
              <dd className={answer.value ? 'break-words text-zinc-900' : 'text-zinc-400'}>
                {answer.value ?? 'Not found in your documents. Enter it yourself.'}
                {answer.needsCheck && <span className="ml-1 text-amber-700">(check this)</span>}
              </dd>
            </div>
            {answer.value && (
              <button
                type="button"
                onClick={() => copy(answer.label, answer.value ?? '')}
                className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
              >
                {copied === answer.label ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-zinc-500">
        Read from your application and documents by AI. Check each answer before you submit.
      </p>
    </div>
  );
}
