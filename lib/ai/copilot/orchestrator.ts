import { z } from 'zod';
import {
  COPILOT_CALL_TIMEOUT_MS,
  COPILOT_DEADLINE_MS,
  COPILOT_MAX_INVALID_TOOL_CALLS,
  COPILOT_MAX_MODEL_CALLS,
  COPILOT_MAX_TOOL_CALLS,
  COPILOT_MAX_TOOL_RESULT_CHARS,
} from '@/lib/ai/config';
import { CitationSchema, MAX_CITATIONS, validateCitations, type CitationValidation, type ValidCitation } from '@/lib/sources/citations';
import { COPILOT_SYSTEM_PROMPT } from './prompt';
import { inputTokensOf, ProviderError, type CopilotProvider, type ProviderMessageParam, type ProviderTool } from './provider';
import type { CopilotTool, ToolContext } from './tools';

// Gate 6.4: one copilot question, as a bounded tool loop (master prompt
// §12). The loop -- not the model -- enforces every limit: model calls,
// tool calls, repeated invalid calls, the wall-clock deadline and each
// call's timeout. A limit ends the turn with a stated reason; it never
// produces a silent partial answer. Tool arguments are parsed with each
// tool's strict Zod schema before anything runs; a bad call goes back to
// the model as an error and counts against the invalid-call limit.
//
// The answer arrives through the give_answer pseudo-tool so its citations
// are structured: each must name evidence retrieved in THIS question and
// quote it verbatim (lib/sources/citations.ts), or it is dropped and
// reported. A reply that ends in plain text instead is shown, flagged as
// uncited. Nothing is persisted here; the caller records usage and tool
// calls through the hooks.

export const GIVE_ANSWER = 'give_answer';

export const GiveAnswerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(8000),
  citations: z.array(CitationSchema).max(MAX_CITATIONS),
  needs_clarification: z.boolean(),
});

export type StopReason =
  | 'answered'
  | 'answered_uncited'
  | 'model_call_limit'
  | 'tool_call_limit'
  | 'invalid_tool_calls'
  | 'deadline'
  | 'refusal'
  | 'output_limit'
  | 'provider_error';

export interface ToolCallRecord {
  name: string;
  arguments: unknown;
  status: 'succeeded' | 'failed' | 'rejected';
  data: unknown;
  error: string | null;
  durationMs: number;
}

export interface TurnResult {
  stoppedBecause: StopReason;
  answer: string | null;
  needsClarification: boolean;
  citations: ValidCitation[];
  rejectedCitations: CitationValidation['rejected'];
  toolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number; modelCalls: number };
  detail: string | null;
}

export interface TurnLimits {
  maxModelCalls: number;
  maxToolCalls: number;
  maxInvalidCalls: number;
  deadlineMs: number;
  callTimeoutMs: number;
  maxToolResultChars: number;
}

export const DEFAULT_LIMITS: TurnLimits = {
  maxModelCalls: COPILOT_MAX_MODEL_CALLS,
  maxToolCalls: COPILOT_MAX_TOOL_CALLS,
  maxInvalidCalls: COPILOT_MAX_INVALID_TOOL_CALLS,
  deadlineMs: COPILOT_DEADLINE_MS,
  callTimeoutMs: COPILOT_CALL_TIMEOUT_MS,
  maxToolResultChars: COPILOT_MAX_TOOL_RESULT_CHARS,
};

export interface TurnHooks {
  onModelCall?(usage: { inputTokens: number; outputTokens: number }, error: string | null): Promise<void> | void;
  onToolCall?(record: ToolCallRecord): Promise<void> | void;
}

export interface TurnInput {
  provider: CopilotProvider;
  tools: readonly CopilotTool[];
  ctx: ToolContext;
  history: { role: 'user' | 'assistant'; text: string }[];
  question: string;
  limits?: Partial<TurnLimits>;
  hooks?: TurnHooks;
  clock?: () => number;
}

// Strict tool schemas reject length, numeric and array-size constraints
// and `pattern`; `format: "uuid"` would reject catalogue ids that are valid
// Postgres uuids but not RFC variants (F6). They are stripped from what the
// API sees -- the tool's own Zod schema still enforces every one of them on
// the arguments before the tool runs.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  'format',
  'default',
]);

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key))
      .map(([key, value]) => [key, key === 'properties' ? Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, stripUnsupported(v)])) : stripUnsupported(value)])
  );
}

export function jsonSchemaFor(schema: z.ZodType): ProviderTool['input_schema'] {
  return stripUnsupported(z.toJSONSchema(schema, { io: 'input' })) as ProviderTool['input_schema'];
}

export function providerTools(tools: readonly CopilotTool[]): ProviderTool[] {
  return [
    ...tools.map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchemaFor(t.input), strict: true })),
    {
      name: GIVE_ANSWER,
      description: 'Deliver your reply to the user, with citations to evidence retrieved in this conversation. Call exactly once, last.',
      input_schema: jsonSchemaFor(GiveAnswerSchema),
      strict: true,
    },
  ];
}

function scopeLine(ctx: ToolContext): string {
  const s = ctx.scope;
  return `Application in scope: "${s.applicationTitle}" -- ${s.permitTypeTitle}, ${s.jurisdictionName}. Today is ${ctx.now.toISOString().slice(0, 10)}.`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated: ${text.length - max} more characters]`;
}

export async function runCopilotTurn(input: TurnInput): Promise<TurnResult> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const clock = input.clock ?? Date.now;
  const started = clock();
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const tools = providerTools(input.tools);
  const invalidByName = new Map<string, number>();
  const result: TurnResult = {
    stoppedBecause: 'model_call_limit',
    answer: null,
    needsClarification: false,
    citations: [],
    rejectedCitations: [],
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
    detail: null,
  };
  const stop = (reason: StopReason, detail: string | null = null) => {
    result.stoppedBecause = reason;
    result.detail = detail;
    return result;
  };

  const messages: ProviderMessageParam[] = [
    ...input.history.map((h) => ({ role: h.role, content: h.text })),
    { role: 'user', content: `${scopeLine(input.ctx)}\n\n${input.question}` },
  ];

  for (let call = 0; call < limits.maxModelCalls; call++) {
    const remaining = limits.deadlineMs - (clock() - started);
    if (remaining <= 0) return stop('deadline');

    let response;
    try {
      response = await input.provider.createMessage({
        system: COPILOT_SYSTEM_PROMPT,
        tools,
        messages,
        signal: AbortSignal.timeout(Math.min(remaining, limits.callTimeoutMs)),
      });
    } catch (error) {
      const detail = error instanceof ProviderError ? error.message : 'unexpected';
      await input.hooks?.onModelCall?.({ inputTokens: 0, outputTokens: 0 }, detail);
      return stop(detail === 'cancelled' || detail === 'timeout' ? 'deadline' : 'provider_error', detail);
    }
    result.usage.modelCalls += 1;
    result.usage.inputTokens += inputTokensOf(response.usage);
    result.usage.outputTokens += response.usage.output_tokens;
    await input.hooks?.onModelCall?.(
      { inputTokens: inputTokensOf(response.usage), outputTokens: response.usage.output_tokens },
      response.stop_reason === 'refusal' ? 'refusal' : null
    );

    // The whole content goes back unchanged (thinking blocks included).
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'refusal') return stop('refusal');
    // A cut-off reply is never acted on: its tool calls may be truncated.
    if (response.stop_reason === 'max_tokens') return stop('output_limit');

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      if (response.stop_reason === 'pause_turn') continue;
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (!text) return stop('provider_error', 'empty reply');
      result.answer = text;
      return stop('answered_uncited');
    }

    const toolResults: Extract<ProviderMessageParam['content'], unknown[]>[number][] = [];
    for (const use of toolUses) {
      if (use.name === GIVE_ANSWER) {
        const parsed = GiveAnswerSchema.safeParse(use.input);
        if (!parsed.success) {
          invalidByName.set(GIVE_ANSWER, (invalidByName.get(GIVE_ANSWER) ?? 0) + 1);
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Invalid give_answer: ${parsed.error.issues.map((i) => i.message).join('; ')}` });
          continue;
        }
        const checked = validateCitations(input.ctx.evidence.bundle(input.ctx.now.toISOString().slice(0, 10)), parsed.data.citations);
        result.answer = parsed.data.answer;
        result.needsClarification = parsed.data.needs_clarification;
        result.citations = checked.valid;
        result.rejectedCitations = checked.rejected;
        return stop('answered');
      }

      const recordCall = async (record: ToolCallRecord, content: string, isError: boolean) => {
        result.toolCalls.push(record);
        await input.hooks?.onToolCall?.(record);
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, is_error: isError, content });
      };

      if (result.toolCalls.length >= limits.maxToolCalls) {
        return stop('tool_call_limit');
      }
      const tool = byName.get(use.name);
      if (!tool) {
        invalidByName.set(use.name, (invalidByName.get(use.name) ?? 0) + 1);
        await recordCall({ name: use.name, arguments: use.input, status: 'rejected', data: null, error: 'unknown tool', durationMs: 0 }, `Unknown tool "${use.name}".`, true);
        continue;
      }
      const args = tool.input.safeParse(use.input);
      if (!args.success) {
        invalidByName.set(use.name, (invalidByName.get(use.name) ?? 0) + 1);
        const message = args.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`).join('; ');
        await recordCall({ name: use.name, arguments: use.input, status: 'rejected', data: null, error: message, durationMs: 0 }, `Invalid arguments: ${message}`, true);
        continue;
      }
      const t0 = clock();
      try {
        const outcome = await tool.run(input.ctx, args.data);
        const durationMs = Math.max(0, clock() - t0);
        if (outcome.ok) {
          await recordCall(
            { name: use.name, arguments: args.data, status: 'succeeded', data: outcome.data, error: null, durationMs },
            truncate(JSON.stringify(outcome.data), limits.maxToolResultChars),
            false
          );
        } else {
          await recordCall({ name: use.name, arguments: args.data, status: 'failed', data: null, error: outcome.error, durationMs }, outcome.error, true);
        }
      } catch {
        await recordCall(
          { name: use.name, arguments: args.data, status: 'failed', data: null, error: 'tool error', durationMs: Math.max(0, clock() - t0) },
          'The tool failed. Say so rather than guessing.',
          true
        );
      }
    }

    const worst = Math.max(0, ...invalidByName.values());
    if (worst >= limits.maxInvalidCalls) return stop('invalid_tool_calls');
    messages.push({ role: 'user', content: toolResults });
  }
  return stop('model_call_limit');
}
