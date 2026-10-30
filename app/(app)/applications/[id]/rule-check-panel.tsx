'use client';

import { useActionState } from 'react';
import { useErrorToast, useSuccessToast } from '@/components/toast/use-action-toast';
import { answerRuleQuestionAction, runRuleCheckAction, type RuleCheckState } from './rule-check-actions';

// Gate 6.5: the latest requirements check (project_requirement_snapshots)
// beside the readiness checklist. "Unknown" is shown as unknown, never as
// "not required"; a rule-based "doesn't apply" only appears when a published
// rule set says so. The project questions the published rules read can be
// answered here; each answer is a confirmed fact and re-runs the check.

export interface RuleQuestion {
  key: string;
  label: string;
  kind: 'number' | 'boolean' | 'enum';
  values: string[];
  hint: string | null;
  answer: string | null;
  awaitingReview: boolean;
}

export interface RuleCheckView {
  evaluatedAt: string | null;
  coverage: string | null;
  applicable: string[];
  notApplicable: string[];
  unknown: { title: string; reason: string }[];
  questions: RuleQuestion[];
}

const REASON: Record<string, string> = {
  no_published_rule_set: 'no published rules for this permit type yet',
  rule_set_invalid: 'the published rules need fixing',
  condition_not_encoded: 'depends on details not yet captured as rules',
  condition_unknown: 'answer the project questions below',
  not_in_rule_set: 'not covered by the published rules',
};

const inputClass = 'rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-900';
const smallButton =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';

function QuestionRow({ applicationId, question }: { applicationId: string; question: RuleQuestion }) {
  const [state, action, pending] = useActionState(answerRuleQuestionAction, {} as RuleCheckState);
  useErrorToast(state.error);
  useSuccessToast(Boolean(state.message), state.message ?? '');
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0 text-xs">
        <div className="font-medium text-zinc-800">{question.label}</div>
        <div className={question.answer ? 'text-zinc-600' : 'text-amber-800'}>
          {question.answer ? `Answered: ${question.answer}` : question.awaitingReview ? 'Suggested from documents; waiting for review' : 'Not answered'}
        </div>
      </div>
      <form action={action} className="flex shrink-0 items-center gap-2">
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="factKey" value={question.key} />
        {question.kind === 'boolean' ? (
          <select name="value" defaultValue="" required className={inputClass} aria-label={question.label}>
            <option value="" disabled>
              Choose…
            </option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        ) : question.kind === 'enum' ? (
          <select name="value" defaultValue="" required className={inputClass} aria-label={question.label}>
            <option value="" disabled>
              Choose…
            </option>
            {question.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <input name="value" required inputMode="decimal" placeholder={question.hint ?? ''} className={`${inputClass} w-40`} aria-label={question.label} />
        )}
        <button type="submit" disabled={pending} className={smallButton}>
          {pending ? 'Saving…' : question.answer ? 'Change' : 'Save'}
        </button>
      </form>
    </li>
  );
}

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
          <button type="submit" disabled={pending} className={smallButton}>
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
      {view.questions.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <h3 className="text-xs font-semibold text-zinc-900">Project questions</h3>
          <p className="text-xs text-zinc-500">The city&apos;s rules depend on these. Each answer is saved as a confirmed project fact and the check runs again.</p>
          <ul className="divide-y divide-zinc-100">
            {view.questions.map((q) => (
              <QuestionRow key={q.key} applicationId={applicationId} question={q} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
