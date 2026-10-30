'use client';

import { useActionState, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import {
  checkSourceNowAction,
  correctRevisionAction,
  dismissCaptureAction,
  publishCaptureAction,
  withdrawRevisionAction,
  type SourceActionState,
} from './actions';

const initialState: SourceActionState = {};
const smallButton =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
const inputClass = 'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900';
const labelClass = 'block text-xs font-medium text-zinc-700';

function useResultToasts(state: SourceActionState) {
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
}

export function CheckNowButton({ sourceId }: { sourceId: string }) {
  const [state, formAction, pending] = useActionState(checkSourceNowAction, initialState);
  useResultToasts(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="sourceId" value={sourceId} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Requesting…' : 'Check now'}
      </button>
    </form>
  );
}

// For sites that refuse automated checks: the admin downloads the official
// document and uploads it here. It is staged as a capture for review, like
// a fetch (app/api/admin/sources/[sourceId]/upload/route.ts).
export function UploadCopyForm({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<SourceActionState>({});
  useResultToasts(state);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setState({ error: 'Choose a file.' });
      return;
    }
    const formData = new FormData();
    formData.set('file', file);
    setPending(true);
    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/upload`, { method: 'POST', body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ error: typeof body.error === 'string' ? body.error : 'Upload failed.' });
        return;
      }
      setState({
        message:
          body.outcome === 'changed'
            ? 'Uploaded. It is waiting for review below.'
            : 'Uploaded. The text is the same as the latest copy, so there is nothing new to review.',
      });
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className={`${labelClass} flex-1`}>
        Upload the official copy <span className="font-normal text-zinc-500">(PDF, HTML or text, up to 4 MB)</span>
        <input ref={fileRef} type="file" name="file" accept=".pdf,.html,.htm,.txt,application/pdf,text/html,text/plain" className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}

export function PublishCaptureForm({
  sourceId,
  captureId,
  defaultTitle,
  defaultIssuingBody,
}: {
  sourceId: string;
  captureId: string;
  defaultTitle: string;
  defaultIssuingBody: string;
}) {
  const [state, formAction, pending] = useActionState(publishCaptureAction, initialState);
  useResultToasts(state);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="captureId" value={captureId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Title
          <input name="title" required maxLength={300} defaultValue={defaultTitle} className={inputClass} />
        </label>
        <label className={labelClass}>
          Issuing body
          <input name="issuingBody" required maxLength={300} defaultValue={defaultIssuingBody} className={inputClass} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Published on <span className="font-normal text-zinc-500">(if the source states it)</span>
          <input type="date" name="publishedOn" className={inputClass} />
        </label>
        <label className={labelClass}>
          Effective from <span className="font-normal text-zinc-500">(blank = unknown)</span>
          <input type="date" name="effectiveFrom" className={inputClass} />
        </label>
        <label className={labelClass}>
          Effective to <span className="font-normal text-zinc-500">(blank = open)</span>
          <input type="date" name="effectiveTo" className={inputClass} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Use rights
          <select name="accessScope" defaultValue="public_no_redistribution" className={inputClass}>
            <option value="public">Public, may be quoted and shared</option>
            <option value="public_no_redistribution">Public, not for republishing</option>
            <option value="licensed_internal">Licensed, internal use only</option>
          </select>
        </label>
        <label className={labelClass}>
          Licence notes
          <input name="licenceNotes" maxLength={2000} className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        Review notes
        <textarea name="notes" rows={2} maxLength={2000} className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? 'Publishing…' : 'Publish as new revision'}
      </button>
    </form>
  );
}

export function DismissCaptureForm({ sourceId, captureId }: { sourceId: string; captureId: string }) {
  const [state, formAction, pending] = useActionState(dismissCaptureAction, initialState);
  useResultToasts(state);
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="captureId" value={captureId} />
      <label className={`${labelClass} flex-1`}>
        Dismiss reason
        <input name="notes" required maxLength={2000} placeholder="e.g. only the page footer changed" className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Saving…' : 'Dismiss'}
      </button>
    </form>
  );
}

// For a typo in a published revision's details (dates, title...): publishes
// a corrected revision of the same text. Collapsed by default.
export function CorrectRevisionForm({
  sourceId,
  revision,
}: {
  sourceId: string;
  revision: {
    id: string;
    title: string;
    issuing_body: string;
    published_on: string | null;
    effective_from: string | null;
    effective_to: string | null;
    access_scope: string;
    licence_notes: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(correctRevisionAction, initialState);
  useResultToasts(state);
  return (
    <details className="rounded-md border border-zinc-200 p-2">
      <summary className="cursor-pointer text-xs font-medium text-zinc-700">Correct details (dates, title…)</summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="sourceId" value={sourceId} />
        <input type="hidden" name="revisionId" value={revision.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Title
            <input name="title" required maxLength={300} defaultValue={revision.title} className={inputClass} />
          </label>
          <label className={labelClass}>
            Issuing body
            <input name="issuingBody" required maxLength={300} defaultValue={revision.issuing_body} className={inputClass} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Published on
            <input type="date" name="publishedOn" defaultValue={revision.published_on ?? ''} className={inputClass} />
          </label>
          <label className={labelClass}>
            Effective from
            <input type="date" name="effectiveFrom" defaultValue={revision.effective_from ?? ''} className={inputClass} />
          </label>
          <label className={labelClass}>
            Effective to
            <input type="date" name="effectiveTo" defaultValue={revision.effective_to ?? ''} className={inputClass} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Use rights
            <select name="accessScope" defaultValue={revision.access_scope} className={inputClass}>
              <option value="public">Public, may be quoted and shared</option>
              <option value="public_no_redistribution">Public, not for republishing</option>
              <option value="licensed_internal">Licensed, internal use only</option>
            </select>
          </label>
          <label className={labelClass}>
            Licence notes
            <input name="licenceNotes" maxLength={2000} defaultValue={revision.licence_notes ?? ''} className={inputClass} />
          </label>
        </div>
        <label className={labelClass}>
          What are you correcting?
          <input name="notes" required maxLength={1900} placeholder="e.g. effective date typo (2926 → 2026)" className={inputClass} />
        </label>
        <button type="submit" disabled={pending} className={smallButton}>
          {pending ? 'Correcting…' : 'Publish corrected revision'}
        </button>
      </form>
    </details>
  );
}

export function WithdrawRevisionForm({ sourceId, revisionId }: { sourceId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(withdrawRevisionAction, initialState);
  useResultToasts(state);
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input name="notes" required maxLength={2000} placeholder="Reason" aria-label="Withdraw reason" className={inputClass} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? 'Saving…' : 'Withdraw'}
      </button>
    </form>
  );
}
