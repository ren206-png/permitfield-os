import type Anthropic from '@anthropic-ai/sdk';

// Bounds on what the browser may send to the help assistant. The whole
// conversation is resent on every question (the API is stateless), so these
// cap the cost of one request as well as its size.
export const HELP_MAX_MESSAGES = 20;
export const HELP_MAX_MESSAGE_CHARS = 2000;

export type HelpMessage = { role: 'user' | 'assistant'; content: string };

// Returns the conversation as API messages, or null if it isn't a well-formed
// help conversation: user/assistant turns, alternating, starting and ending
// with the customer, every turn non-empty and within the length cap.
export function toHelpMessages(input: unknown): Anthropic.MessageParam[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > HELP_MAX_MESSAGES) return null;
  const messages: Anthropic.MessageParam[] = [];
  for (const [index, item] of input.entries()) {
    if (typeof item !== 'object' || item === null) return null;
    const { role, content } = item as Record<string, unknown>;
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    if (role !== expectedRole || typeof content !== 'string') return null;
    const text = content.trim();
    if (!text || text.length > HELP_MAX_MESSAGE_CHARS) return null;
    messages.push({ role: expectedRole, content: text });
  }
  return messages[messages.length - 1].role === 'user' ? messages : null;
}

const PAGE_DESCRIPTIONS: [RegExp, string][] = [
  [/^\/applications\/new$/, 'the New application form'],
  [/^\/applications\/[^/]+$/, "an application's page (documents, extraction summary, filled form, signatures, Permit progress checklist, submission)"],
  [/^\/applications$/, 'the Applications list'],
  [/^\/projects\/new$/, 'the New project form'],
  [/^\/dashboard$/, 'the Dashboard'],
  [/^\/notifications$/, 'Notifications'],
  [/^\/clients(\/.*)?$/, 'Clients'],
  [/^\/estimates(\/.*)?$/, 'Estimates'],
  [/^\/invoices(\/.*)?$/, 'Invoices'],
  [/^\/change-orders(\/.*)?$/, 'Change orders'],
  [/^\/contractors\/new$/, 'the Add a contractor form'],
  [/^\/onboarding$/, 'company setup (onboarding)'],
  [/^\/settings\/team$/, 'Team settings'],
  [/^\/settings\/security$/, 'Security settings (two-factor sign-in)'],
  [/^\/settings\/api-keys$/, 'API keys'],
  [/^\/settings\/tax-profile$/, 'Tax profile'],
  [/^\/settings\/notifications$/, 'Notification settings'],
];

// A plain description of where the customer is, for the assistant's context.
// Only the route shape is used, never ids or query strings.
export function describeHelpPage(path: unknown): string {
  if (typeof path !== 'string' || path.length > 200) return 'an unknown page';
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return PAGE_DESCRIPTIONS.find(([pattern]) => pattern.test(clean))?.[1] ?? 'another page of the app';
}
