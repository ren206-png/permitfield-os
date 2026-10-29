import Anthropic from '@anthropic-ai/sdk';
import { COPILOT_CALL_TIMEOUT_MS, COPILOT_MAX_TOKENS } from '@/lib/ai/config';
import { routeAiTask } from '@/lib/ai/router';

// Gate 6.4: the copilot's model adapter (master prompt §12). The
// orchestrator only sees CopilotProvider, so tests run it against a
// scripted double (orchestrator.test.ts) and nothing in the loop depends on
// the vendor beyond the Messages API shapes it passes through.
//
// Model: routeAiTask('copilot') -> claude-sonnet-5-5 (Ren's decision Q1).
// - Adaptive thinking (the model's default) at effort "medium", the
//   recommended starting point for multistep tool use on this model.
// - Server-side refusal fallback ("default" routing) so a safety-classifier
//   decline is retried on a fallback model inside the same call; a refusal
//   that survives it is still handled by the orchestrator.
// - tool_choice stays "auto": this model rejects forced tool choice; the
//   system prompt asks for give_answer and the orchestrator handles a plain
//   text ending.
// - System prompt and tool list are fixed per release, so the system block
//   carries the cache breakpoint (tools render before system).

export type ProviderMessage = Anthropic.Beta.Messages.BetaMessage;
export type ProviderMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type ProviderTool = Anthropic.Beta.Messages.BetaTool;

export interface ProviderRequest {
  system: string;
  tools: ProviderTool[];
  messages: ProviderMessageParam[];
  signal: AbortSignal;
}

export interface CopilotProvider {
  modelId: string;
  createMessage(request: ProviderRequest): Promise<ProviderMessage>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export function anthropicCopilotProvider(client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 })): CopilotProvider {
  const { provider, modelId } = routeAiTask('copilot');
  if (provider !== 'anthropic') throw new Error(`copilot is routed to ${provider}, but only the Anthropic adapter exists`);
  return {
    modelId,
    async createMessage({ system, tools, messages, signal }) {
      try {
        return await client.beta.messages.create(
          {
            model: modelId,
            max_tokens: COPILOT_MAX_TOKENS,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            tools,
            tool_choice: { type: 'auto' },
            messages,
          },
          { signal, timeout: COPILOT_CALL_TIMEOUT_MS }
        );
      } catch (error) {
        if (error instanceof Anthropic.APIUserAbortError) throw new ProviderError('cancelled', false);
        if (error instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limited', true);
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError('timeout', true);
        if (error instanceof Anthropic.APIConnectionError) throw new ProviderError('connection', true);
        if (error instanceof Anthropic.APIError) throw new ProviderError(`api_${error.status ?? 'error'}`, (error.status ?? 0) >= 500);
        // Anything else (e.g. no credentials configured) is still a provider
        // failure to the user, never an unhandled crash.
        throw new ProviderError('unexpected', false);
      }
    },
  };
}
