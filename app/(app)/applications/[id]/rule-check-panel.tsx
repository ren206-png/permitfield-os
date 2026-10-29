'use client';

import { useActionState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { runRuleCheckAction, type RuleCheckState } from './rule-check-actions';

// Gate 6.5: the latest requirements check (project_requirement_snapshots)
// beside the readiness checklist. "Unknown" is shown as unknown, never as
// "not required"; a rule-based "doesn't apply" only appears when a published
// rule set says so.

export interface RuleCheckView {
  evaluatedAt: string | null;
  coverage: string | null;
  applicable: string[];
  notApplicable: string[];
  unknown: { title: string; reason: string }[];
}

const REASON: Record<string, string> = {
  no_published_rule_set: 'no published rules for this permit type yet',
  rule_set_invalid: 'the published rules need fixing',
  condition_not_encoded: 'depends on details not yet captured as rules',
  condition_unknown: 'needs a confirmed project fact',
  not_in_rule_set: 'not covered by the published rules',
};

export function RuleCheckPanel({ applicationId, view }: { applicationId: string; view: RuleCheckView }) {
  const [state, action, pending] = useActionState(runRuleCheckAction, {} as RuleCheckState);
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Requirements check</h2>
        <form action={action}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <button type="submit" disabled={pending} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50">
            {pending ? 'Checking…' : view.evaluatedAt ? 'Check again' : 'Run check'}
          </button>
        </form>
      </div>
      {!view.evaluatedAt ? (
        <p className="mt-2 text-sm text-zinc-500">Not run yet. It uses only confirmed project facts.</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-zinc-700">
            {view.applicable.length} apply · {view.notApplicable.length} don&apos;t apply under the published rules · {view.unknown.length} unknown
          </p>
          {view.unknown.length > 0 && (
            <ul className="space-y-0.5 text-xs text-zinc-600">
              {view.unknown.slice(0, 12).map((u, i) => (
                <li key={i}>
                  {u.title}: <span className="text-amber-800">unknown ({REASON[u.reason] ?? u.reason})</span>
                </li>
              ))}
              {view.unknown.length > 12 && <li>…and {view.unknown.length - 12} more</li>}
            </ul>
          )}
          <p className="text-xs text-zinc-500">Unknown never means &quot;not required&quot;. Treat unknown items as required until they are settled.</p>
        </div>
      )}
    </section>
  );
}
