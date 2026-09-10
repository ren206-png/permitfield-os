'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const DOC_KINDS = [
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'spec_sheet', label: 'Spec sheet' },
  { value: 'scope_of_work', label: 'Scope of work' },
  { value: 'other', label: 'Other' },
] as const;

// Posts directly to the existing app/api/documents/route.ts multipart
// endpoint (Phase 2) -- this component is new, that endpoint isn't. The
// "start AI review" checkbox maps 1:1 to that route's `complete === 'true'`
// field, which is the only thing that fires permit/application.documents_ready.
export function DocumentUpload({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docKind, setDocKind] = useState<(typeof DOC_KINDS)[number]['value']>('other');
  const [triggerExtraction, setTriggerExtraction] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setError('Choose at least one file.');
      return;
    }

    const formData = new FormData();
    formData.set('applicationId', applicationId);
    formData.set('docKind', docKind);
    if (triggerExtraction) formData.set('complete', 'true');
    for (const file of Array.from(files)) formData.append('file', file);

    setPending(true);
    try {
      const res = await fetch('/api/documents', { method: 'POST', body: formData });
      const body = await res.json();
      // The route now reports per-file outcomes instead of failing the
      // whole batch on the first bad file (app/api/documents/route.ts), so
      // a response can be a total failure (no documentIds, res.ok false),
      // a partial success (some documentIds AND some failures, 207), or a
      // full success. router.refresh() runs whenever anything actually got
      // stored, so a partial success is reflected in the document list
      // immediately rather than looking like nothing happened.
      const failures: { file: string; error: string }[] = Array.isArray(body.failures) ? body.failures : [];
      const documentIds: string[] = Array.isArray(body.documentIds) ? body.documentIds : [];

      if (!res.ok && documentIds.length === 0) {
        setError(
          failures.length > 0
            ? `Upload failed: ${failures.map((f) => `${f.file} (${f.error})`).join('; ')}`
            : (body.error ?? 'Upload failed.')
        );
        return;
      }

      if (failures.length > 0) {
        setWarning(
          `${documentIds.length} of ${files.length} file(s) uploaded. Failed: ${failures
            .map((f) => `${f.file} (${f.error})`)
            .join('; ')}. Extraction was not started -- retry the failed file(s) first.`
        );
      } else {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setTriggerExtraction(false);
      }
      router.refresh();
    } catch {
      setError('Upload failed -- check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="docFile" className="mb-1 block text-sm font-medium text-zinc-700">
            File(s)
          </label>
          <input
            id="docFile"
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/tiff"
            className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-zinc-200"
          />
        </div>
        <div>
          <label htmlFor="docKind" className="mb-1 block text-sm font-medium text-zinc-700">
            Document type
          </label>
          <select
            id="docKind"
            value={docKind}
            onChange={(e) => setDocKind(e.target.value as typeof docKind)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            {DOC_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={triggerExtraction}
          onChange={(e) => setTriggerExtraction(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        This is my last upload for now -- start AI extraction
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {warning && (
        <p role="alert" className="text-sm text-amber-700">
          {warning}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}
