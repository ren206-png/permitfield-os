import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { LocalTime } from '@/components/local-time';
import { requireAdmin } from '@/lib/auth/admin';
import { isSourceRegistryEnabled } from '@/lib/flags';
import { changedHunks, diffLines } from '@/lib/sources/diff';
import { createServiceClient } from '@/lib/supabase/service-client';
import { CheckNowButton, DismissCaptureForm, PublishCaptureForm, UploadCopyForm, WithdrawRevisionForm } from '../source-controls';

// One source (Gate 6.3): fetched changes waiting for review, each diffed
// against the text of the revision currently published (or, before any
// publication, the previous capture); the published revisions; and the
// check history. A site that refuses automated checks can be captured by
// uploading the official copy (migration 20260806000100); uploaded captures
// and checks say so.

interface CaptureRow {
  id: string;
  content_sha256: string;
  content_type: string;
  loader: string;
  text_content: string;
  chunks: unknown[];
  captured_at: string;
}

interface RevisionRow {
  id: string;
  revision_number: number;
  title: string;
  issuing_body: string;
  published_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  access_scope: string;
  created_at: string;
}

interface ReviewRow {
  source_revision_id: string;
  status: string;
  notes: string | null;
  reviewed_at: string;
}

interface DecisionRow {
  capture_id: string;
  decision: string;
  source_revision_id: string | null;
  notes: string | null;
  decided_at: string;
}

interface CheckRow {
  id: string;
  outcome: string;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  requested_by: string | null;
  method: 'fetched' | 'uploaded';
  uploaded_file_name: string | null;
  capture_id: string | null;
  checked_at: string;
}

const MAX_DIFF_ROWS_SHOWN = 400;

function DiffView({ before, after }: { before: string | null; after: string }) {
  if (before === null) {
    return <p className="text-sm text-zinc-600">First capture of this source: there is nothing to compare it with. Read the text below.</p>;
  }
  const diff = diffLines(before, after);
  if (!diff.computed) {
    return (
      <p className="text-sm text-amber-800">
        Too large to diff here ({diff.beforeLines} → {diff.afterLines} lines). Compare the text below with the live page before publishing.
      </p>
    );
  }
  if (diff.added === 0 && diff.removed === 0) {
    return <p className="text-sm text-zinc-600">The text is identical to the comparison text.</p>;
  }
  const hunks = changedHunks(diff.ops);
  return (
    <div className="space-y-1">
      <p className="text-xs text-zinc-600">
        {diff.added} line{diff.added === 1 ? '' : 's'} added, {diff.removed} removed.
      </p>
      <pre className="max-h-[28rem] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs leading-5">
        {hunks.slice(0, MAX_DIFF_ROWS_SHOWN).map((h, i) =>
          h.op === 'gap' ? (
            <div key={i} className="text-zinc-400">
              ⋯ {h.count} unchanged line{h.count === 1 ? '' : 's'}
            </div>
          ) : (
            <div
              key={i}
              className={h.op === 'added' ? 'bg-emerald-50 text-emerald-900' : h.op === 'removed' ? 'bg-rose-50 text-rose-900 line-through' : 'text-zinc-700'}
            >
              {h.op === 'added' ? '+ ' : h.op === 'removed' ? '− ' : '  '}
              {h.line}
            </div>
          )
        )}
        {hunks.length > MAX_DIFF_ROWS_SHOWN && <div className="text-amber-800">… {hunks.length - MAX_DIFF_ROWS_SHOWN} more diff rows not shown.</div>}
      </pre>
    </div>
  );
}

export default async function SourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  await requireAdmin();
  if (!isSourceRegistryEnabled()) notFound();
  const { sourceId } = await params;
  if (!z.guid().safeParse(sourceId).success) notFound();

  const supabase = createServiceClient();
  const { data: source } = await supabase
    .from('jurisdiction_sources')
    .select('id, url, source_type, archived_at, jurisdictions ( municipality, province_code )')
    .eq('id', sourceId)
    .maybeSingle();
  if (!source) notFound();

  const [captures, revisions, checks] = await Promise.all([
    supabase
      .from('source_captures')
      .select('id, content_sha256, content_type, loader, text_content, chunks, captured_at')
      .eq('source_id', sourceId)
      .order('captured_at', { ascending: false })
      .limit(20),
    supabase
      .from('source_revisions')
      .select('id, revision_number, title, issuing_body, published_on, effective_from, effective_to, access_scope, created_at')
      .eq('source_id', sourceId)
      .order('revision_number', { ascending: false }),
    supabase
      .from('source_check_runs')
      .select('id, outcome, http_status, error_code, error_message, requested_by, method, uploaded_file_name, capture_id, checked_at')
      .eq('source_id', sourceId)
      .order('checked_at', { ascending: false })
      .limit(20),
  ]);
  const loadError = captures.error ?? revisions.error ?? checks.error;
  if (loadError) throw new Error(`Could not load source: ${loadError.message}`);

  const captureRows = (captures.data ?? []) as CaptureRow[];
  const revisionRows = (revisions.data ?? []) as RevisionRow[];
  const captureIds = captureRows.map((c) => c.id);
  const revisionIds = revisionRows.map((r) => r.id);

  const [decisions, reviews] = await Promise.all([
    captureIds.length
      ? supabase.from('source_capture_decisions').select('capture_id, decision, source_revision_id, notes, decided_at').in('capture_id', captureIds)
      : Promise.resolve({ data: [], error: null }),
    revisionIds.length
      ? supabase
          .from('source_revision_reviews')
          .select('source_revision_id, status, notes, reviewed_at')
          .in('source_revision_id', revisionIds)
          .order('reviewed_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (decisions.error || reviews.error) throw new Error(`Could not load review state: ${(decisions.error ?? reviews.error)?.message}`);

  const decisionByCapture = new Map(((decisions.data ?? []) as DecisionRow[]).map((d) => [d.capture_id, d]));
  const latestReview = new Map<string, ReviewRow>();
  for (const r of (reviews.data ?? []) as ReviewRow[]) if (!latestReview.has(r.source_revision_id)) latestReview.set(r.source_revision_id, r);

  // Comparison text: the capture behind the newest published revision.
  const publishedCapture = captureRows.find((c) => {
    const d = decisionByCapture.get(c.id);
    return d?.decision === 'published' && d.source_revision_id && latestReview.get(d.source_revision_id)?.status === 'verified';
  });
  const openCaptures = captureRows.filter((c) => !decisionByCapture.has(c.id));
  const checkRows = (checks.data ?? []) as CheckRow[];
  // The check that created each capture ('changed'); an 'unchanged' check
  // also points at the capture it matched, so it is not the origin.
  const originByCapture = new Map<string, CheckRow>();
  for (const c of checkRows) if (c.capture_id && c.outcome === 'changed') originByCapture.set(c.capture_id, c);
  const jurisdiction = Array.isArray(source.jurisdictions) ? source.jurisdictions[0] : source.jurisdictions;
  const place = jurisdiction ? `${jurisdiction.municipality ?? 'Province-wide'}, ${jurisdiction.province_code}` : '';
  const defaultIssuer = jurisdiction?.municipality ? `City of ${jurisdiction.municipality}` : '';

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/admin/sources" className="text-sm text-zinc-500 hover:text-zinc-800">
            ← Sources
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">{place}</h1>
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-sky-800 underline">
            {source.url}
          </a>
          <div className="text-xs text-zinc-500">{String(source.source_type).replace('_', ' ')}</div>
        </div>
        {!source.archived_at && <CheckNowButton sourceId={source.id} />}
      </div>

      {!source.archived_at && <UploadCopyForm sourceId={source.id} />}

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-zinc-900">Waiting for review ({openCaptures.length})</h2>
        {openCaptures.length === 0 && <p className="text-sm text-zinc-500">Nothing to review.</p>}
        {openCaptures.map((capture) => {
          const previous = publishedCapture ?? captureRows.find((c) => c.captured_at < capture.captured_at) ?? null;
          const origin = originByCapture.get(capture.id);
          return (
            <article key={capture.id} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs text-zinc-600">
                {origin?.method === 'uploaded' ? `Uploaded by an admin (${origin.uploaded_file_name})` : 'Fetched'}{' '}
                <LocalTime value={capture.captured_at} /> · {capture.loader.toUpperCase()} · {capture.chunks.length} passages · compared with{' '}
                {publishedCapture ? 'the published text' : previous ? 'the previous fetch' : 'nothing'}
              </div>
              <DiffView before={previous?.text_content ?? null} after={capture.text_content} />
              <details>
                <summary className="cursor-pointer text-xs text-zinc-600">Full captured text</summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs">{capture.text_content}</pre>
              </details>
              <PublishCaptureForm
                sourceId={source.id}
                captureId={capture.id}
                defaultTitle={revisionRows[0]?.title ?? ''}
                defaultIssuingBody={revisionRows[0]?.issuing_body ?? defaultIssuer}
              />
              <DismissCaptureForm sourceId={source.id} captureId={capture.id} />
            </article>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">Revisions</h2>
        {revisionRows.length === 0 ? (
          <p className="text-sm text-zinc-500">None published. Nothing from this source is used as evidence yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
            {revisionRows.map((r) => {
              const review = latestReview.get(r.id);
              const live = review?.status === 'verified';
              return (
                <li key={r.id} className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-900">
                      Revision {r.revision_number}: {r.title}
                    </span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${live ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                      {live ? 'Published' : review ? `Withdrawn (${review.status})` : 'Not reviewed'}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600">
                    {r.issuing_body} · effective {r.effective_from ?? 'unknown'} to {r.effective_to ?? 'open'} · {r.access_scope.replaceAll('_', ' ')} · added{' '}
                    <LocalTime value={r.created_at} dateOnly />
                    {review?.notes ? ` · “${review.notes}”` : ''}
                  </div>
                  {live && <WithdrawRevisionForm sourceId={source.id} revisionId={r.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-900">Check history</h2>
        {checkRows.length === 0 ? (
          <p className="text-sm text-zinc-500">Never checked.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-xs">
            {checkRows.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3 gap-y-1 p-2 text-zinc-700">
                <LocalTime value={c.checked_at} />
                <span className="font-medium">{c.outcome.replace('_', ' ')}</span>
                {c.http_status && <span>HTTP {c.http_status}</span>}
                {c.error_code && (
                  <span className="text-rose-700">
                    {c.error_code}
                    {c.error_message ? `: ${c.error_message}` : ''}
                  </span>
                )}
                <span className="text-zinc-400">
                  {c.method === 'uploaded' ? `uploaded: ${c.uploaded_file_name}` : c.requested_by ? 'manual' : 'scheduled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
