'use client';

import { useState, useTransition } from 'react';
import type { StopReason } from '@/lib/ai/copilot/orchestrator';
import { askCopilotAction, type CopilotCitationView, type CopilotReply, type CopilotToolView } from './actions';

// Gate 6.4: the copilot conversation. The browser keeps the conversation
// (plain text only) and sends it with each question; nothing is stored as a
// transcript. Cards under an answer render the tools' own output, so
// statuses, counts and outcomes shown there come from PermitField's records,
// not from the model's wording.

type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; reply: Extract<CopilotReply, { ok: true }> }
  | { role: 'error'; text: string };

const TOOL_LABELS: Record<string, string> = {
  resolve_project_authorities: 'Checked who issues the permit',
  get_permit_requirements: 'Read the requirement list',
  evaluate_permit_applicability: 'Ran the published rules on your confirmed facts',
  search_permit_sources: 'Searched the official sources',
  explain_requirement: 'Looked up a requirement',
  assess_package_readiness: 'Checked the submission checklist',
  get_permit_status: 'Read the recorded status',
};

const STOP_NOTES: Partial<Record<StopReason, string>> = {
  answered_uncited: 'This answer has no checked citations.',
  model_call_limit: 'The copilot hit its step limit before finishing. Try a narrower question.',
  tool_call_limit: 'The copilot hit its lookup limit before finishing. Try a narrower question.',
  invalid_tool_calls: 'The copilot stopped after repeated failed lookups.',
  deadline: 'The copilot ran out of time. Try again or ask something narrower.',
  refusal: "The copilot can't help with that request.",
  output_limit: 'The answer was too long and was cut off, so it was not shown.',
  provider_error: 'The copilot could not reach the AI service. Your records are unchanged; try again shortly.',
};

function ToolCard({ tool }: { tool: CopilotToolView }) {
  const label = TOOL_LABELS[tool.name] ?? tool.name;
  if (tool.status !== 'succeeded') {
    return <li className="text-xs text-zinc-500">{label}: failed{tool.error ? ` (${tool.error})` : ''}</li>;
  }
  const data = tool.data as Record<string, unknown>;
  let detail: string | null = null;
  if (tool.name === 'evaluate_permit_applicability') {
    const s = data.summary as { total: number; applicable: number; notApplicable: number; unknown: number; coverage: string } | undefined;
    if (s) {
      detail =
        s.coverage === 'published_rule_set'
          ? `${s.applicable} apply, ${s.notApplicable} don't, ${s.unknown} unknown (of ${s.total})`
          : `No usable published rule set: all ${s.total} unknown`;
    }
  } else if (tool.name === 'assess_package_readiness') {
    detail = `${data.required_complete}/${data.required_total} required items complete`;
  } else if (tool.name === 'get_permit_status') {
    detail = `Recorded status: ${String(data.permit_status ?? data.processing_status)}`;
  } else if (tool.name === 'search_permit_sources') {
    const n = Array.isArray(data.results) ? data.results.length : 0;
    detail = `${n} passage${n === 1 ? '' : 's'} found`;
  }
  return (
    <li className="text-xs text-zinc-600">
      {label}
      {detail ? <span className="text-zinc-900"> · {detail}</span> : null}
    </li>
  );
}

function Citation({ citation }: { citation: CopilotCitationView }) {
  return (
    <li className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs">
      <div className="font-medium text-zinc-800">
        [{citation.evidenceId}]{' '}
        {citation.url ? (
          <a href={citation.url} target="_blank" rel="noopener noreferrer" className="underline">
            {citation.title}
          </a>
        ) : (
          citation.title
        )}
      </div>
      <div className="text-zinc-500">
        {citation.locator}
        {citation.effective ? ` · in effect ${citation.effective}` : ''}
        {citation.freshness === 'overdue' ? ' · source re-check overdue' : ''}
        {citation.kind === 'contractor_document' ? ' · not an official requirement' : ''}
      </div>
      <blockquote className="mt-1 border-l-2 border-zinc-300 pl-2 text-zinc-700">“{citation.quote}”</blockquote>
    </li>
  );
}

export function CopilotChat({ applicationId }: { applicationId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();

  const send = () => {
    const question = draft.trim();
    if (!question || pending) return;
    const history = turns.flatMap((t): { role: 'user' | 'assistant'; text: string }[] =>
      t.role === 'user' ? [{ role: 'user', text: t.text }] : t.role === 'assistant' && t.reply.answer ? [{ role: 'assistant', text: t.reply.answer }] : []
    );
    setTurns((prev) => [...prev, { role: 'user', text: question }]);
    setDraft('');
    startTransition(async () => {
      try {
        const reply = await askCopilotAction({ applicationId, history, question });
        setTurns((prev) => [...prev, reply.ok ? { role: 'assistant', reply } : { role: 'error', text: reply.error }]);
      } catch {
        setTurns((prev) => [...prev, { role: 'error', text: 'Something went wrong. Your records are unchanged; try again.' }]);
      }
    });
  };

  return (
    <section className="flex min-h-[28rem] flex-col rounded-lg border border-zinc-200 bg-white">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="text-sm text-zinc-600">
            <p>Ask about this application, for example:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Which requirements apply, and what is still unknown?</li>
              <li>What does the city say about the floor plan drawings?</li>
              <li>What is still missing before I can submit?</li>
            </ul>
          </div>
        )}
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm whitespace-pre-wrap text-white">
              {turn.text}
            </div>
          ) : turn.role === 'error' ? (
            <div key={i} className="max-w-[85%] rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {turn.text}
            </div>
          ) : (
            <div key={i} className="max-w-[95%] space-y-2">
              {turn.reply.answer && (turn.reply.stoppedBecause === 'answered' || turn.reply.stoppedBecause === 'answered_uncited') && (
                <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm whitespace-pre-wrap text-zinc-900">{turn.reply.answer}</div>
              )}
              {STOP_NOTES[turn.reply.stoppedBecause] && <p className="text-xs text-amber-800">{STOP_NOTES[turn.reply.stoppedBecause]}</p>}
              {turn.reply.discardedCitations > 0 && (
                <p className="text-xs text-amber-800">
                  {turn.reply.discardedCitations} citation{turn.reply.discardedCitations === 1 ? '' : 's'} could not be matched to a source and{' '}
                  {turn.reply.discardedCitations === 1 ? 'was' : 'were'} removed.
                </p>
              )}
              {turn.reply.citations.length > 0 && (
                <ul className="space-y-1.5">
                  {turn.reply.citations.map((c, j) => (
                    <Citation key={j} citation={c} />
                  ))}
                </ul>
              )}
              {turn.reply.tools.length > 0 && (
                <ul className="space-y-0.5 border-l-2 border-zinc-200 pl-2">
                  {turn.reply.tools.map((t, j) => (
                    <ToolCard key={j} tool={t} />
                  ))}
                </ul>
              )}
            </div>
          )
        )}
        {pending && <p className="text-sm text-zinc-500">Working…</p>}
      </div>
      <form
        className="flex gap-2 border-t border-zinc-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ask about this application"
          aria-label="Question"
          className="flex-1 resize-none rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="self-end rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
