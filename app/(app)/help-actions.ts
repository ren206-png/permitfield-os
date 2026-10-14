'use server';

import Anthropic from '@anthropic-ai/sdk';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isAiAssistantEnabled } from '@/lib/flags';
import { createServiceClient } from '@/lib/supabase/service-client';
import { HELP_GUIDE } from '@/lib/help/guide';
import { describeHelpPage, HELP_MAX_MESSAGE_CHARS, toHelpMessages } from '@/lib/help/conversation';
import { HELP_HOURLY_QUESTION_LIMIT, HELP_MAX_TOKENS, HELP_MODEL_ID } from '@/lib/ai/config';
import { checkOrgMonthlyCostCap, checkUserDailyCostCap } from '@/lib/ai/cost-caps';
import { estimateCostUsdCents } from '@/lib/ai/estimate-cost';
import { AiJobInsertSchema, AiTokenLedgerInsertSchema } from '@/lib/ai/schemas/ai-task';
import { SUPPORT_EMAIL } from '@/lib/brand';

export type HelpAnswer = { answer: string } | { error: string };

// Frozen first so the guide is a stable, cacheable prefix; the page the
// customer is on goes in a second block after it.
const SYSTEM_PROMPT = `You are the help assistant inside PermitField OS, a web app that helps Canadian contractors prepare and file commercial building permit applications. You answer customers' questions about how to use the app, using only the guide below.

How to answer:
- Give the concrete steps in the app: which page, panel and button. Short numbered steps or a few sentences. Plain text; a dash or number list is fine, no headings or tables.
- If the guide doesn't cover the question, say you're not sure, and suggest emailing ${SUPPORT_EMAIL}. Never guess at features, cities, prices or timelines the guide doesn't state.
- You can't see the customer's applications, documents or account, and you can't change anything. If they report something broken, an error message, or an account or sign-in problem, tell them to email ${SUPPORT_EMAIL} with what they did and what they saw.
- Questions about building codes, what a city will approve, or legal matters: you can explain what the app does, but say PermitField isn't legal or code advice and they should confirm with the city.
- Stay on PermitField and permit filing. Politely decline anything unrelated.
- Answer in the customer's language.

`;

const TROUBLE = `The assistant couldn't answer just now. Try again in a minute, or email ${SUPPORT_EMAIL}.`;

// Help questions are user-initiated, so the job carries requested_by_user_id
// and counts toward the per-user daily cap (lib/ai/cost-caps.ts).
// ai_jobs / ai_token_ledger have no INSERT policy for `authenticated`, so the
// rows are written with the service client (lib/supabase/service-client.ts,
// Exception 5) using the org and user resolved from the caller's own session.
async function recordHelpJob(
  service: ReturnType<typeof createServiceClient>,
  ids: { orgId: string; userId: string },
  usage: { inputTokens: number; outputTokens: number },
  errorMessage: string | null
): Promise<void> {
  const { data: job } = await service
    .from('ai_jobs')
    .insert(
      AiJobInsertSchema.parse({
        org_id: ids.orgId,
        kind: 'assistant',
        provider: 'anthropic',
        model_id: HELP_MODEL_ID,
        status: errorMessage ? 'failed' : 'succeeded',
        input_token_count: usage.inputTokens,
        output_token_count: usage.outputTokens,
        error_message: errorMessage,
        related_entity_type: null,
        related_entity_id: null,
        requested_by_user_id: ids.userId,
      })
    )
    .select('id')
    .single();
  if (!job || (usage.inputTokens === 0 && usage.outputTokens === 0)) return;
  await service.from('ai_token_ledger').insert(
    AiTokenLedgerInsertSchema.parse({
      org_id: ids.orgId,
      job_id: job.id,
      provider: 'anthropic',
      model_id: HELP_MODEL_ID,
      input_token_count: usage.inputTokens,
      output_token_count: usage.outputTokens,
      cost_usd_cents: estimateCostUsdCents(usage.inputTokens, usage.outputTokens),
    })
  );
}

export async function askHelpAction(input: { messages: unknown; pagePath: unknown }): Promise<HelpAnswer> {
  if (!isAiAssistantEnabled()) return { error: 'Help is not available right now.' };
  const { orgId, userId } = await requireOrgContext();

  const messages = toHelpMessages(input.messages);
  if (!messages) {
    return { error: `That question couldn't be sent. Keep it under ${HELP_MAX_MESSAGE_CHARS.toLocaleString('en-CA')} characters.` };
  }

  const service = createServiceClient();
  const { count, error: countError } = await service
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by_user_id', userId)
    .eq('kind', 'assistant')
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (countError) return { error: TROUBLE };
  if ((count ?? 0) >= HELP_HOURLY_QUESTION_LIMIT) {
    return { error: `That's a lot of questions for one hour. Try again later, or email ${SUPPORT_EMAIL}.` };
  }
  const [userCap, orgCap] = await Promise.all([checkUserDailyCostCap(service, userId), checkOrgMonthlyCostCap(service, orgId)]);
  if (!userCap.withinCap || !orgCap.withinCap) {
    return { error: `The assistant has reached its limit for now. Email ${SUPPORT_EMAIL} and we'll help directly.` };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: HELP_MODEL_ID,
      max_tokens: HELP_MAX_TOKENS,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT + HELP_GUIDE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `The customer is currently on ${describeHelpPage(input.pagePath)}.` },
      ],
      messages,
    });
  } catch (error) {
    const message = error instanceof Anthropic.APIError ? `Claude API ${error.status ?? 'error'}: ${error.message}` : String(error);
    await recordHelpJob(service, { orgId, userId }, { inputTokens: 0, outputTokens: 0 }, message.slice(0, 500));
    return { error: TROUBLE };
  }

  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === 'refusal') {
    await recordHelpJob(service, { orgId, userId }, usage, 'refusal');
    return { error: `The assistant can't help with that one. Email ${SUPPORT_EMAIL} and we'll take a look.` };
  }

  const answer = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  await recordHelpJob(service, { orgId, userId }, usage, answer ? null : 'empty answer');
  if (!answer) return { error: TROUBLE };
  return { answer: response.stop_reason === 'max_tokens' ? `${answer}…` : answer };
}
