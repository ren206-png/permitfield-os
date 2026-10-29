import { z } from 'zod';
import { COPILOT_HOURLY_MODEL_CALL_LIMIT } from '@/lib/ai/config';
import { checkOrgMonthlyCostCap, checkUserDailyCostCap } from '@/lib/ai/cost-caps';
import { estimateCostUsdCents } from '@/lib/ai/estimate-cost';
import { AiJobInsertSchema, AiTokenLedgerInsertSchema } from '@/lib/ai/schemas/ai-task';
import type { ToolCallRecord } from '@/lib/ai/copilot/orchestrator';
import { resolveCopilotScope, type CopilotScope } from '@/lib/ai/copilot/scope';
import { requireOrgContext } from '@/lib/auth/org-context';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { FEE_ENGINE_VERSION, type FeeEstimate } from '@/lib/fees/estimate';
import { isCopilotEnabled } from '@/lib/flags';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';

// Gate 6.4/6.5: server-side helpers shared by the copilot's actions
// (actions.ts, draft-actions.ts). Deliberately NOT a 'use server' module, so
// none of these is exposed as a callable action. Scope is always resolved
// with the caller's own session; the ledger writes use the service client
// with ids from that scope (service-client.ts Exception 9).

export type ServiceClient = ReturnType<typeof createServiceClient>;

export async function sessionScope(applicationId: unknown) {
  if (!isCopilotEnabled()) return null;
  const { userId } = await requireOrgContext();
  const parsed = z.guid().safeParse(applicationId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const scope = await resolveCopilotScope(supabase, userId, parsed.data);
  return scope ? { supabase, scope } : null;
}

// Rate limit + cost caps before any model call.
export async function checkCopilotBudget(service: ServiceClient, scope: CopilotScope): Promise<string | null> {
  const { count, error } = await service
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by_user_id', scope.userId)
    .eq('kind', 'copilot')
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (error) return 'The copilot could not start. Try again in a minute.';
  if ((count ?? 0) >= COPILOT_HOURLY_MODEL_CALL_LIMIT) return "You've used the copilot a lot in the last hour. Try again later.";
  const [userCap, orgCap] = await Promise.all([checkUserDailyCostCap(service, scope.userId), checkOrgMonthlyCostCap(service, scope.orgId)]);
  if (!userCap.withinCap || !orgCap.withinCap) return `The copilot has reached its spending limit for now. Email ${SUPPORT_EMAIL} if you need it raised.`;
  if (!process.env.ANTHROPIC_API_KEY) return 'The copilot is not set up on this site yet (no AI service key).';
  return null;
}

export async function recordModelCall(
  service: ServiceClient,
  scope: CopilotScope,
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
  error: string | null
) {
  const { data: job } = await service
    .from('ai_jobs')
    .insert(
      AiJobInsertSchema.parse({
        org_id: scope.orgId,
        kind: 'copilot',
        provider: 'anthropic',
        model_id: modelId,
        status: error ? 'failed' : 'succeeded',
        input_token_count: usage.inputTokens,
        output_token_count: usage.outputTokens,
        error_message: error,
        related_entity_type: 'permit_application',
        related_entity_id: scope.applicationId,
        requested_by_user_id: scope.userId,
      })
    )
    .select('id')
    .single();
  if (!job || (usage.inputTokens === 0 && usage.outputTokens === 0)) return;
  await service.from('ai_token_ledger').insert(
    AiTokenLedgerInsertSchema.parse({
      org_id: scope.orgId,
      job_id: job.id,
      provider: 'anthropic',
      model_id: modelId,
      input_token_count: usage.inputTokens,
      output_token_count: usage.outputTokens,
      cost_usd_cents: estimateCostUsdCents(usage.inputTokens, usage.outputTokens),
    })
  );
}

const MAX_LEDGER_RESULT_CHARS = 20_000;

export async function recordToolCall(
  service: ServiceClient,
  scope: CopilotScope,
  traceId: string,
  modelId: string,
  call: ToolCallRecord
) {
  const serialized = call.data === null ? null : JSON.stringify(call.data);
  await service.from('copilot_tool_invocations').insert({
    org_id: scope.orgId,
    project_id: scope.projectId,
    user_id: scope.userId,
    trace_id: traceId,
    // A name the model invented may not fit the column's pattern; keep the row.
    tool_name: `x_${call.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(call.name.match(/^[a-z][a-z0-9_]{2,63}$/) ? 2 : 0, 66).slice(0, 64),
    arguments: call.arguments ?? {},
    result: serialized === null ? null : serialized.length > MAX_LEDGER_RESULT_CHARS ? { truncated: true, chars: serialized.length } : call.data,
    status: call.status,
    error_message: call.status === 'succeeded' ? null : (call.error ?? 'failed').slice(0, 1000),
    model_id: modelId,
    duration_ms: call.durationMs,
  });
}

export async function recordFeeEstimate(service: ServiceClient, scope: CopilotScope, estimate: FeeEstimate) {
  await service.from('fee_estimates').insert({
    org_id: scope.orgId,
    application_id: scope.applicationId,
    fee_schedule_version_id: estimate.scheduleId,
    status: estimate.status,
    total_minor: estimate.status === 'estimated' ? estimate.totalMinor : null,
    currency: estimate.status === 'estimated' ? estimate.currency : null,
    calculation: {
      lines: estimate.lines,
      deposits_minor: estimate.depositsMinor,
      missing_inputs: estimate.missingInputs,
      exclusions: estimate.exclusions,
      assumptions: estimate.assumptions,
      reasons: estimate.reasons,
      schedule_version: estimate.scheduleVersion,
    },
    engine_version: FEE_ENGINE_VERSION,
    computed_by: scope.userId,
  });
}
