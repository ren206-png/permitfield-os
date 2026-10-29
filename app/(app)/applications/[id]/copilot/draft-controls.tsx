'use client';

import { useActionState, useState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { DRAFT_EXPORT_HEADER } from '@/lib/drafts/versions';
import {
  estimateFeesAction,
  generateDraftAction,
  recordCorrectionRequestAction,
  saveDraftAction,
  type DraftActionState,
} from './draft-actions';

// Gate 6.5: the Drafts and Fees panels on the copilot page. Every save is a
// new version; an AI draft never replaces a person's edit (it is shown as a
// suggestion beside it). Downloads carry a DRAFT header.

const initialState: DraftActionState = {};
const smallButton =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900';

function useResultToasts(state: DraftActionState) {
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
}

export interface DraftThreadView {
  kind: 'cover_letter' | 'correction_response';
  title: string;
  threadId: string | null;
  correctionRequestId: string | null;
  latest: { version: number; origin: 'ai_generated' | 'human_edited'; body: string; createdAt: string } | null;
}

function download(thread: DraftThreadView, body: string, version: number) {
  const blob = new Blob([DRAFT_EXPORT_HEADER(thread.title, version) + body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${thread.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-draft-v${version}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DraftEditor({ applicationId, thread }: { applicationId: string; thread: DraftThreadView }) {
  const [saveState, save, saving] = useActionState(saveDraftAction, initialState);
  const [genState, generate, generating] = useActionState(generateDraftAction, initialState);
  const [body, setBody] = useState(thread.latest?.body ?? '');
  useResultToasts(saveState);
  useResultToasts(genState);

  const hidden = (
    <>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="kind" value={thread.kind} />
      <input type="hidden" name="threadId" value={thread.threadId ?? ''} />
      <input type="hidden" name="correctionRequestId" value={thread.correctionRequestId ?? ''} />
    </>
  );

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-zinc-900">{thread.title}</h4>
        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          {thread.latest
            ? `Draft v${thread.latest.version} · ${thread.latest.origin === 'ai_generated' ? 'written by AI, not yet edited' : 'edited by your team'}`
            : 'No draft yet'}
        </span>
      </div>
      <form action={save} className="space-y-2">
        {hidden}
        <input type="hidden" name="baseVersion" value={thread.latest?.version ?? ''} />
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={body ? 10 : 3}
          placeholder="Write the draft, or use Draft with AI."
          aria-label={`${thread.title} text`}
          className={`${inputClass} font-mono text-xs`}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving || !body.trim()} className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save as new version'}
          </button>
          {thread.latest && (
            <button type="button" className={smallButton} onClick={() => download(thread, thread.latest!.body, thread.latest!.version)}>
              Download v{thread.latest.version}
            </button>
          )}
        </div>
      </form>
      <form action={generate}>
        {hidden}
        <button type="submit" disabled={generating} className={smallButton}>
          {generating ? 'Drafting…' : thread.latest?.origin === 'human_edited' ? 'Suggest an AI version' : 'Draft with AI'}
        </button>
      </form>
      {genState.suggestion && (
        <div className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-2">
          <p className="text-xs text-sky-900">AI suggestion (not saved). Your version above is unchanged.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-800">{genState.suggestion}</pre>
          <button type="button" className={smallButton} onClick={() => setBody(genState.suggestion!)}>
            Put this in the editor
          </button>
        </div>
      )}
      <p className="text-xs text-zinc-500">Drafts are never sent or signed from here. Sign and send them yourself after checking every line.</p>
    </div>
  );
}

export function CorrectionRequestForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(recordCorrectionRequestAction, initialState);
  useResultToasts(state);
  return (
    <details className="rounded-md border border-zinc-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-zinc-900">Record a correction request from the city</summary>
      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="applicationId" value={applicationId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium text-zinc-700">
            Received on
            <input type="date" name="receivedOn" required className={inputClass} />
          </label>
          <label className="text-xs font-medium text-zinc-700">
            City reference (optional)
            <input name="reference" maxLength={200} className={inputClass} />
          </label>
        </div>
        <label className="block text-xs font-medium text-zinc-700">
          Items, one per line, as the city wrote them
          <textarea name="items" required rows={5} className={inputClass} />
        </label>
        <button type="submit" disabled={pending} className={smallButton}>
          {pending ? 'Saving…' : 'Record request'}
        </button>
      </form>
    </details>
  );
}

export function RecalculateFeesButton({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(estimateFeesAction, initialState);
  useResultToasts(state);
  return (
    <form action={action}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Calculating…' : 'Recalculate'}
      </button>
    </form>
  );
}
