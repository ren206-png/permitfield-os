'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { askHelpAction, type HelpAnswer } from '@/app/(app)/help-actions';
import { HELP_MAX_MESSAGES } from '@/lib/help/conversation';

type Turn = { role: 'user' | 'assistant'; content: string };

const STARTERS = ['How do I start a new application?', 'How do I get the form signed?', 'How do I submit to the city?'];

// "Need help?" button on every signed-in page (PERMITFIELD_FF_AI_ASSISTANT).
// The conversation lives only in this component's state; each question
// sends it to askHelpAction(), which answers from lib/help/guide.ts.
export function HelpAssistant({ supportEmail }: { supportEmail: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, pending, error]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    // Keep the conversation within the server's message window: drop the
    // oldest question/answer pairs (so it still starts with a question)
    // rather than refusing to continue.
    let history = turns;
    while (history.length + 1 > HELP_MAX_MESSAGES) history = history.slice(2);
    const next: Turn[] = [...history, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    setError(null);
    setPending(true);
    let result: HelpAnswer;
    try {
      result = await askHelpAction({ messages: next, pagePath: pathname });
    } catch {
      result = { error: `The assistant couldn't answer just now. Try again, or email ${supportEmail}.` };
    }
    setPending(false);
    if ('answer' in result) {
      setTurns([...next, { role: 'assistant', content: result.answer }]);
    } else {
      // Take the unanswered question back out so the conversation still
      // alternates, and put it back in the box to retry.
      setTurns(history);
      setDraft(text);
      setError(result.error);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-zinc-700"
      >
        Need help?
      </button>
    );
  }

  return (
    <section
      aria-label="Help assistant"
      className="fixed inset-x-2 bottom-2 z-40 flex max-h-[80vh] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
    >
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">PermitField help</h2>
          <p className="text-xs text-zinc-500">AI answers about using the app. Not legal or code advice.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-zinc-900" aria-label="Close help">
          Close
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-zinc-600">Ask how to do something in PermitField, for example:</p>
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => void ask(starter)}
                className="block w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-zinc-700 hover:border-zinc-400"
              >
                {starter}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, index) => (
          <p
            key={index}
            className={
              turn.role === 'user'
                ? 'ml-8 whitespace-pre-wrap rounded-lg bg-zinc-900 px-3 py-2 text-white'
                : 'mr-4 whitespace-pre-wrap rounded-lg bg-zinc-100 px-3 py-2 text-zinc-800'
            }
          >
            {turn.content}
          </p>
        ))}
        {pending && <p className="mr-4 rounded-lg bg-zinc-100 px-3 py-2 text-zinc-500">Thinking…</p>}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-zinc-200 p-3">
        <label htmlFor="help-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="help-question"
          ref={inputRef}
          rows={2}
          maxLength={2000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(draft);
            }
          }}
          placeholder="Type a question…"
          className="w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">
            Still stuck? Email{' '}
            <a href={`mailto:${supportEmail}`} className="underline underline-offset-2">
              {supportEmail}
            </a>
          </p>
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ask
          </button>
        </div>
      </form>
    </section>
  );
}
