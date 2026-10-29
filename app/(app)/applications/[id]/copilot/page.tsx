import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveCopilotScope } from '@/lib/ai/copilot/scope';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isCopilotEnabled } from '@/lib/flags';
import { describeFactValue, FACT_KEYS } from '@/lib/requirements/rules/fact-keys';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import { createClient } from '@/lib/supabase/server';
import { CopilotChat } from './copilot-chat';
import { CorrectionRequestForm, DraftEditor, RecalculateFeesButton, type DraftThreadView } from './draft-controls';
import { EnterFactForm, ProposeFromDocumentsButton, ReviewFactButtons } from './fact-controls';
import { formatMinor, minor } from '@/lib/fees/money';

// Gate 6.4: the staff copilot for one application. Left: the project facts
// the rule engine may use -- confirmed facts, proposals waiting for review
// (from the documents), and a form to enter one. Right: questions to the
// copilot. Everything is read with the signed-in user's own session.

interface FactRow extends ProjectFactRow {
  provenance: string;
  source_locator: string | null;
}

export default async function CopilotPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isCopilotEnabled()) notFound();
  const { userId } = await requireOrgContext();
  const { id } = await params;
  const supabase = await createClient();
  const scope = await resolveCopilotScope(supabase, userId, id);
  if (!scope) notFound();

  const { data: factRows } = scope.projectId
    ? await supabase
        .from('project_facts')
        .select('id, fact_key, value, unit, state, supersedes_fact_id, created_at, provenance, source_locator')
        .eq('org_id', scope.orgId)
        .eq('project_id', scope.projectId)
        .order('created_at', { ascending: false })
    : { data: [] as FactRow[] };
  const rows = (factRows ?? []) as FactRow[];

  const [{ data: corrections }, { data: draftRows }, { data: latestEstimate }] = await Promise.all([
    supabase
      .from('correction_requests')
      .select('id, received_on, reference, items')
      .eq('org_id', scope.orgId)
      .eq('application_id', scope.applicationId)
      .order('received_on', { ascending: false }),
    supabase
      .from('application_draft_versions')
      .select('thread_id, kind, correction_request_id, version, origin, body, created_at')
      .eq('org_id', scope.orgId)
      .eq('application_id', scope.applicationId)
      .order('version', { ascending: false }),
    supabase
      .from('fee_estimates')
      .select('status, total_minor, currency, calculation, computed_at')
      .eq('org_id', scope.orgId)
      .eq('application_id', scope.applicationId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  type DraftRow = { thread_id: string; kind: 'cover_letter' | 'correction_response'; correction_request_id: string | null; version: number; origin: 'ai_generated' | 'human_edited'; body: string; created_at: string };
  const latestOf = (pred: (d: DraftRow) => boolean) => ((draftRows ?? []) as DraftRow[]).find(pred) ?? null;
  const toThread = (kind: DraftThreadView['kind'], title: string, correctionRequestId: string | null): DraftThreadView => {
    const latest = latestOf((d) => d.kind === kind && d.correction_request_id === correctionRequestId);
    return {
      kind,
      title,
      threadId: latest?.thread_id ?? null,
      correctionRequestId,
      latest: latest ? { version: latest.version, origin: latest.origin, body: latest.body, createdAt: latest.created_at } : null,
    };
  };
  const threads: DraftThreadView[] = [
    toThread('cover_letter', 'Cover letter', null),
    ...(corrections ?? []).map((c) =>
      toThread('correction_response', `Response to the correction request of ${c.received_on}${c.reference ? ` (${c.reference})` : ''}`, c.id)
    ),
  ];
  const estimateCalc = (latestEstimate?.calculation ?? null) as {
    lines?: { label: string; category: string; amountMinor: number }[];
    missing_inputs?: string[];
    exclusions?: string[];
    reasons?: string[];
  } | null;
  const ESTIMATE_LABEL: Record<string, string> = {
    estimated: 'Estimate',
    missing_inputs: 'Needs more facts',
    stale_schedule: 'Fee schedule out of date',
    authority_quote_required: 'Set by the city after review',
    unavailable: 'No fee schedule yet',
  };
  const { facts } = resolveFacts(rows);
  const decided = new Set(rows.map((r) => r.supersedes_fact_id).filter(Boolean));
  const proposals = rows.filter((r) => r.state === 'proposed' && !decided.has(r.id));
  const label = (key: string) => (FACT_KEYS as Record<string, { label: string }>)[key]?.label ?? key;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/applications/${scope.applicationId}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {scope.applicationTitle}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900">Copilot</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          {scope.permitTypeTitle}, {scope.jurisdictionName}. Answers come from this application&apos;s records and the official sources PermitField has
          reviewed. It can be wrong and it is not legal or code advice; it can&apos;t submit, sign or change anything.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">Project facts</h2>
            <p className="mt-1 text-xs text-zinc-600">Only confirmed facts are used to decide which requirements apply.</p>
            {!scope.projectId ? (
              <p className="mt-3 text-sm text-amber-800">This application is not linked to a project, so facts can&apos;t be recorded.</p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-zinc-100 text-sm">
                  {[...facts.entries()]
                    .filter(([, f]) => f.status === 'confirmed')
                    .map(([key, f]) => (
                      <li key={key} className="flex justify-between gap-3 py-1.5">
                        <span className="text-zinc-600">{label(key)}</span>
                        <span className="font-medium text-zinc-900">{f.status === 'confirmed' ? describeFactValue(key, f.value, f.unit) : ''}</span>
                      </li>
                    ))}
                  {![...facts.values()].some((f) => f.status === 'confirmed') && <li className="py-1.5 text-zinc-500">No confirmed facts yet.</li>}
                </ul>

                {proposals.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Waiting for your check</h3>
                    <ul className="mt-2 space-y-2">
                      {proposals.map((p) => (
                        <li key={p.id} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
                          <div className="flex justify-between gap-2">
                            <span className="text-zinc-700">{label(p.fact_key)}</span>
                            <span className="font-medium text-zinc-900">{describeFactValue(p.fact_key, p.value, p.unit)}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-600">
                            Read from your documents{p.source_locator ? `, ${p.source_locator}` : ''}. Check it against the drawings.
                          </div>
                          <ReviewFactButtons applicationId={scope.applicationId} factId={p.id} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-3">
                  <ProposeFromDocumentsButton applicationId={scope.applicationId} />
                  <EnterFactForm applicationId={scope.applicationId} />
                </div>
              </>
            )}
          </div>
        </section>

        <CopilotChat applicationId={scope.applicationId} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">Permit fees</h2>
            <RecalculateFeesButton applicationId={scope.applicationId} />
          </div>
          {!latestEstimate ? (
            <p className="mt-2 text-sm text-zinc-500">Not calculated yet.</p>
          ) : (
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-600">{ESTIMATE_LABEL[latestEstimate.status] ?? latestEstimate.status}</span>
                {latestEstimate.status === 'estimated' && latestEstimate.total_minor !== null && (
                  <span className="font-semibold text-zinc-900">{formatMinor(minor(Number(latestEstimate.total_minor)), latestEstimate.currency ?? 'CAD')}</span>
                )}
              </div>
              {(estimateCalc?.lines ?? []).length > 0 && (
                <ul className="divide-y divide-zinc-100 text-xs">
                  {estimateCalc!.lines!.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2 py-1">
                      <span className="text-zinc-600">
                        {l.label}
                        {l.category !== 'fee' ? ` (${l.category})` : ''}
                      </span>
                      <span className="text-zinc-900">{formatMinor(minor(l.amountMinor), latestEstimate.currency ?? 'CAD')}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(estimateCalc?.missing_inputs ?? []).length > 0 && <p className="text-xs text-amber-800">Missing: {estimateCalc!.missing_inputs!.join(', ')}</p>}
              {(estimateCalc?.reasons ?? []).map((r, i) => (
                <p key={i} className="text-xs text-zinc-600">
                  {r}
                </p>
              ))}
              {(estimateCalc?.exclusions ?? []).length > 0 && <p className="text-xs text-zinc-500">Not included: {estimateCalc!.exclusions!.join('; ')}</p>}
              <p className="text-xs text-zinc-500">An estimate from the published schedule, not the amount the city will charge.</p>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Letters and responses</h2>
          {threads.map((t) => (
            <DraftEditor key={`${t.kind}-${t.correctionRequestId ?? 'cover'}-${t.latest?.version ?? 0}`} applicationId={scope.applicationId} thread={t} />
          ))}
          <CorrectionRequestForm applicationId={scope.applicationId} />
        </section>
      </div>
    </div>
  );
}
