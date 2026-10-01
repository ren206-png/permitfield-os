'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GENERATED_BUCKET } from '@/lib/storage/documents';
import {
  cancelSignatureAction,
  prepareSignedFormUploadAction,
  recordSignedFormUploadAction,
  requestSignatureAction,
  type SignatureActionState,
} from './signature-actions';

const initialState: SignatureActionState = {};

const buttonClass =
  'rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60';

function Result({ state }: { state: SignatureActionState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-xs text-red-600">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <div role="status" className="mt-2 flex flex-col gap-1 text-xs text-emerald-700">
      <p>{state.message}</p>
      {state.signUrl && (
        <div className="flex items-center gap-2">
          <input readOnly value={state.signUrl} className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-zinc-700" />
          <button
            type="button"
            className="font-medium text-zinc-900 underline underline-offset-2"
            onClick={() => {
              void navigator.clipboard.writeText(state.signUrl ?? '').then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  );
}

export function RequestSignatureForm({
  applicationId,
  filingId,
  signerRole,
  defaultName,
  defaultEmail,
  submitLabel,
}: {
  applicationId: string;
  filingId: string;
  signerRole: 'applicant' | 'owner';
  defaultName: string;
  defaultEmail: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(requestSignatureAction, initialState);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  return (
    <form action={formAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="filingId" value={filingId} />
      <input type="hidden" name="signerRole" value={signerRole} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
          Signer&apos;s name
          <input
            name="signerName"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-700">
          Signer&apos;s email
          <input
            name="signerEmail"
            type="email"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Sending…' : submitLabel}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function CancelSignatureButton({ applicationId, requestId }: { applicationId: string; requestId: string }) {
  const [state, formAction, pending] = useActionState(cancelSignatureAction, initialState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="requestId" value={requestId} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-zinc-700 underline underline-offset-2 disabled:opacity-60">
        {pending ? 'Cancelling…' : 'Cancel request'}
      </button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Uploads straight to storage through a one-time signed URL (large scans
// never pass through a server function), then asks the server to check and
// record it. See signature-actions.ts.
export function UploadSignedFormForm({ applicationId, filingId }: { applicationId: string; filingId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<SignatureActionState>({});
  const [pending, setPending] = useState(false);

  async function upload() {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({ error: 'That file is too large (25 MB maximum).' });
      return;
    }
    setPending(true);
    setState({});
    try {
      const prepared = await prepareSignedFormUploadAction({ applicationId, filingId, sha256: await sha256Hex(file), size: file.size });
      if ('error' in prepared) {
        setState({ error: prepared.error });
        return;
      }
      const { error } = await createClient()
        .storage.from(GENERATED_BUCKET)
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: 'application/pdf' });
      if (error) {
        setState({ error: `Upload failed: ${error.message}` });
        return;
      }
      setState(await recordSignedFormUploadAction({ applicationId, filingId, path: prepared.path }));
      setFile(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        type="file"
        accept="application/pdf"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="min-w-0 flex-1 text-xs text-zinc-700 file:mr-2 file:rounded file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-xs"
        aria-label="Signed form PDF"
      />
      <button type="button" disabled={pending || !file} onClick={() => void upload()} className={buttonClass}>
        {pending ? 'Uploading…' : 'Upload signed copy'}
      </button>
      <Result state={state} />
    </div>
  );
}
