'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DOC_KINDS } from '@/lib/documents/doc-kinds';
import { base64ToBytes, nativeApp, scanFileName, useIsNativeApp } from '@/lib/native/app';


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
  // iPhone app only: pages scanned with the camera (DocumentScannerPlugin),
  // uploaded together with any chosen files.
  const isNativeApp = useIsNativeApp();
  const [canScan, setCanScan] = useState(false);
  const [scans, setScans] = useState<{ file: File; pageCount: number }[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!isNativeApp) return;
    nativeApp()
      ?.Plugins?.DocumentScanner?.isAvailable()
      .then((result) => setCanScan(result.available))
      .catch(() => setCanScan(false));
  }, [isNativeApp]);

  async function handleScan() {
    const scanner = nativeApp()?.Plugins?.DocumentScanner;
    if (!scanner) return;
    setError(null);
    setScanning(true);
    try {
      const result = await scanner.scan();
      if (result.base64) {
        const file = new File([base64ToBytes(result.base64)], scanFileName(new Date()), { type: 'application/pdf' });
        setScans((current) => [...current, { file, pageCount: result.pageCount ?? 1 }]);
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'The scan did not work. Try again.');
    } finally {
      setScanning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    const files = [...Array.from(fileInputRef.current?.files ?? []), ...scans.map((scan) => scan.file)];
    if (files.length === 0) {
      setError(isNativeApp ? 'Choose at least one file, or scan a document.' : 'Choose at least one file.');
      return;
    }

    const formData = new FormData();
    formData.set('applicationId', applicationId);
    formData.set('docKind', docKind);
    if (triggerExtraction) formData.set('complete', 'true');
    for (const file of files) formData.append('file', file);

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
        setScans([]);
        setTriggerExtraction(false);
        // The route saved the files but refused to re-run extraction
        // (signed, submitted, or a run in progress -- lib/extraction/rerun.ts).
        if (typeof body.extractionNotStarted === 'string') setWarning(body.extractionNotStarted);
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
          {canScan && (
            <button
              type="button"
              onClick={() => void handleScan()}
              disabled={scanning || pending}
              className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scanning ? 'Scanning…' : 'Scan with camera'}
            </button>
          )}
          {scans.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-zinc-700">
              {scans.map((scan, index) => (
                <li key={scan.file.name + index} className="flex items-center justify-between gap-2">
                  <span>
                    {scan.file.name} ({scan.pageCount} page{scan.pageCount === 1 ? '' : 's'})
                  </span>
                  <button
                    type="button"
                    onClick={() => setScans((current) => current.filter((_, i) => i !== index))}
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
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
