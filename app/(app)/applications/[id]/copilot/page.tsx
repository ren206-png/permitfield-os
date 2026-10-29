import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveCopilotScope } from '@/lib/ai/copilot/scope';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isCopilotEnabled } from '@/lib/flags';
import { describeFactValue, FACT_KEYS } from '@/lib/requirements/rules/fact-keys';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import { createClient } from '@/lib/supabase/server';
import { CopilotChat } from './copilot-chat';
import { EnterFactForm, ProposeFromDocumentsButton, ReviewFactButtons } from './fact-controls';

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
    </div>
  );
}
