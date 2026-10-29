'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  COPILOT_HOURLY_MODEL_CALL_LIMIT,
  COPILOT_MAX_MESSAGE_CHARS,
  COPILOT_MAX_TURNS,
} from '@/lib/ai/config';
import { checkOrgMonthlyCostCap, checkUserDailyCostCap } from '@/lib/ai/cost-caps';
import { estimateCostUsdCents } from '@/lib/ai/estimate-cost';
import { AiJobInsertSchema, AiTokenLedgerInsertSchema } from '@/lib/ai/schemas/ai-task';
import { proposalsFromExtraction } from '@/lib/ai/copilot/facts-from-extraction';
import { runCopilotTurn, type StopReason, type ToolCallRecord } from '@/lib/ai/copilot/orchestrator';
import { anthropicCopilotProvider } from '@/lib/ai/copilot/provider';
import { resolveCopilotScope, type CopilotScope } from '@/lib/ai/copilot/scope';
import { COPILOT_TOOLS, EvidenceRegistry } from '@/lib/ai/copilot/tools';
import { requireOrgContext } from '@/lib/auth/org-context';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { isCopilotEnabled } from '@/lib/flags';
import { isFactKey, parseFactValue } from '@/lib/requirements/rules/fact-keys';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';

// Gate 6.4: the staff copilot's server actions. Every action checks the
// flag, signs the caller in (requireOrgContext), and resolves the
// application with the caller's OWN session -- RLS decides whether it
// exists for them. Tools and fact writes run on that session. Only the
// usage/tool ledgers are written with the service client (service-client.ts
// Exception 9), with ids taken from the resolved scope.

const NOT_AVAILABLE = 'The copilot is not available.';

async function sessionScope(applicationId: unknown) {
  if (!isCopilotEnabled()) return null;
  const { userId } = await requireOrgContext();
  const parsed = z.guid().safeParse(applicationId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const scope = await resolveCopilotScope(supabase, userId, parsed.data);
  return scope ? { supabase, scope } : null;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const HistorySchema = z
  .array(z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(COPILOT_MAX_MESSAGE_CHARS * 3) }))
  .max(COPILOT_MAX_TURNS * 2);

export interface CopilotCitationView {
  evidenceId: string;
  quote: string;
  kind: 'official_source' | 'contractor_document';
  title: string;
  locator: string;
  url: string | null;
  effective: string | null;
  freshness: string | null;
}

export interface CopilotToolView {
  name: string;
  status: ToolCallRecord['status'];
  data: unknown;
  error: string | null;
}

export type CopilotReply =
  | {
      ok: true;
      answer: string | null;
      needsClarification: boolean;
      citations: CopilotCitationView[];
      discardedCitations: number;
      tools: CopilotToolView[];
      stoppedBecause: StopReason;
    }
  | { ok: false; error: string };

async function recordModelCall(
  service: ReturnType<typeof createServiceClient>,
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

async function recordToolCall(
  service: ReturnType<typeof createServiceClient>,
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

export async function askCopilotAction(input: { applicationId: unknown; history: unknown; question: unknown }): Promise<CopilotReply> {
  const session = await sessionScope(input.applicationId);
  if (!session) return { ok: false, error: NOT_AVAILABLE };
  const { supabase, scope } = session;

  const question = z.string().trim().min(1).max(COPILOT_MAX_MESSAGE_CHARS).safeParse(input.question);
  const history = HistorySchema.safeParse(input.history ?? []);
  if (!question.success || !history.success) {
    return { ok: false, error: `Keep each question under ${COPILOT_MAX_MESSAGE_CHARS.toLocaleString('en-CA')} characters.` };
  }

  const service = createServiceClient();
  const { count, error: countError } = await service
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by_user_id', scope.userId)
    .eq('kind', 'copilot')
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (countError) return { ok: false, error: 'The copilot could not start. Try again in a minute.' };
  if ((count ?? 0) >= COPILOT_HOURLY_MODEL_CALL_LIMIT) {
    return { ok: false, error: "You've used the copilot a lot in the last hour. Try again later." };
  }
  const [userCap, orgCap] = await Promise.all([checkUserDailyCostCap(service, scope.userId), checkOrgMonthlyCostCap(service, scope.orgId)]);
  if (!userCap.withinCap || !orgCap.withinCap) {
    return { ok: false, error: `The copilot has reached its spending limit for now. Email ${SUPPORT_EMAIL} if you need it raised.` };
  }

  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'The copilot is not set up on this site yet (no AI service key).' };
  const provider = anthropicCopilotProvider();
  const traceId = randomUUID();
  const evidence = new EvidenceRegistry();
  const turn = await runCopilotTurn({
    provider,
    tools: COPILOT_TOOLS,
    ctx: { supabase, scope, evidence, now: new Date() },
    history: history.data,
    question: question.data,
    hooks: {
      onModelCall: (usage, error) => recordModelCall(service, scope, provider.modelId, usage, error),
      onToolCall: (call) => recordToolCall(service, scope, traceId, provider.modelId, call),
    },
  });

  return {
    ok: true,
    answer: turn.answer,
    needsClarification: turn.needsClarification,
    citations: turn.citations.map(({ evidenceId, quote, evidence: item }) => ({
      evidenceId,
      quote,
      kind: item.kind,
      title: item.kind === 'official_source' ? `${item.title} (${item.issuingBody})` : 'Your uploaded document',
      locator: item.locator,
      url: item.kind === 'official_source' ? item.url : null,
      effective: item.kind === 'official_source' ? `${item.effectiveFrom ?? 'unknown'} to ${item.effectiveTo ?? 'open'}` : null,
      freshness: item.kind === 'official_source' ? item.freshness : null,
    })),
    discardedCitations: turn.rejectedCitations.length,
    tools: turn.toolCalls.map((c) => ({ name: c.name, status: c.status, data: c.data, error: c.error })),
    stoppedBecause: turn.stoppedBecause,
  };
}

// ---------------------------------------------------------------------------
// Fact review (master prompt §13: human review before any fact is used)
// ---------------------------------------------------------------------------

export interface FactActionState {
  error?: string;
  message?: string;
}

const formValue = (formData: FormData, key: string) => String(formData.get(key) ?? '');

function refresh(applicationId: string) {
  revalidatePath(`/applications/${applicationId}/copilot`);
}

export async function proposeFactsFromDocumentsAction(_prev: FactActionState, formData: FormData): Promise<FactActionState> {
  const session = await sessionScope(formValue(formData, 'applicationId'));
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  if (!scope.projectId) return { error: 'This application is not linked to a project, so facts cannot be recorded for it.' };

  const { data: extraction } = await supabase
    .from('extractions')
    .select('id, parsed_data')
    .eq('application_id', scope.applicationId)
    .eq('zod_valid', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!extraction) return { error: 'No document extraction yet. Upload documents and run extraction first.' };

  const { data: existing } = await supabase
    .from('project_facts')
    .select('fact_key, value, state')
    .eq('org_id', scope.orgId)
    .eq('project_id', scope.projectId);
  const seen = new Set((existing ?? []).filter((f) => f.state !== 'rejected').map((f) => `${f.fact_key}=${JSON.stringify(f.value)}`));
  const proposals = proposalsFromExtraction(extraction.parsed_data).filter((p) => !seen.has(`${p.factKey}=${JSON.stringify(p.value)}`));
  if (proposals.length === 0) return { message: 'Nothing new to propose from the documents.' };

  const { error } = await supabase.from('project_facts').insert(
    proposals.map((p) => ({
      org_id: scope.orgId,
      project_id: scope.projectId,
      fact_key: p.factKey,
      value: p.value,
      unit: p.unit,
      provenance: 'document_extraction',
      source_document_id: p.sourceDocumentId,
      source_locator: p.sourceLocator,
      state: 'proposed',
      created_by: scope.userId,
    }))
  );
  if (error) return { error: 'Could not record the proposed facts.' };
  refresh(scope.applicationId);
  return { message: `${proposals.length} fact${proposals.length === 1 ? '' : 's'} proposed from the documents. Check each one.` };
}

async function decide(formData: FormData, state: 'confirmed' | 'rejected'): Promise<FactActionState> {
  const session = await sessionScope(formValue(formData, 'applicationId'));
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  const factId = z.guid().safeParse(formValue(formData, 'factId'));
  if (!factId.success || !scope.projectId) return { error: 'Invalid fact.' };

  const { data: proposal } = await supabase
    .from('project_facts')
    .select('id, fact_key, value, unit, provenance, source_document_id, source_locator, state')
    .eq('id', factId.data)
    .eq('org_id', scope.orgId)
    .eq('project_id', scope.projectId)
    .maybeSingle();
  if (!proposal || proposal.state !== 'proposed') return { error: 'That fact is not waiting for review.' };

  const now = new Date().toISOString();
  const { error } = await supabase.from('project_facts').insert({
    org_id: scope.orgId,
    project_id: scope.projectId,
    fact_key: proposal.fact_key,
    value: proposal.value,
    unit: proposal.unit,
    provenance: proposal.provenance,
    source_document_id: proposal.source_document_id,
    source_locator: proposal.source_locator,
    state,
    reviewed_by: scope.userId,
    reviewed_at: now,
    supersedes_fact_id: proposal.id,
    created_by: scope.userId,
  });
  // 23505: someone already decided this proposal (project_facts_superseded_once).
  if (error) return { error: error.code === '23505' ? 'Someone already reviewed this fact. Refresh to see it.' : 'Could not save the review.' };
  refresh(scope.applicationId);
  return { message: state === 'confirmed' ? 'Confirmed.' : 'Rejected.' };
}

export async function confirmFactAction(_prev: FactActionState, formData: FormData): Promise<FactActionState> {
  return decide(formData, 'confirmed');
}

export async function rejectFactAction(_prev: FactActionState, formData: FormData): Promise<FactActionState> {
  return decide(formData, 'rejected');
}

// A fact typed in by staff is confirmed by the person entering it. If the
// key already has a confirmed value, the new row supersedes it (a
// correction), leaving the old one in the ledger.
export async function enterFactAction(_prev: FactActionState, formData: FormData): Promise<FactActionState> {
  const session = await sessionScope(formValue(formData, 'applicationId'));
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  if (!scope.projectId) return { error: 'This application is not linked to a project, so facts cannot be recorded for it.' };

  const key = formValue(formData, 'factKey');
  if (!isFactKey(key)) return { error: 'Choose a fact.' };
  const parsed = parseFactValue(key, formValue(formData, 'value'));
  if (!parsed.ok) return { error: parsed.error };

  const { data: current } = await supabase
    .from('project_facts')
    .select('id, state, supersedes_fact_id, created_at')
    .eq('org_id', scope.orgId)
    .eq('project_id', scope.projectId)
    .eq('fact_key', key)
    .eq('state', 'confirmed')
    .order('created_at', { ascending: false });
  const supersededIds = new Set((current ?? []).map((r) => r.supersedes_fact_id).filter(Boolean));
  const latest = (current ?? []).find((r) => !supersededIds.has(r.id)) ?? null;

  const now = new Date().toISOString();
  const { error } = await supabase.from('project_facts').insert({
    org_id: scope.orgId,
    project_id: scope.projectId,
    fact_key: key,
    value: parsed.value,
    unit: parsed.unit,
    provenance: 'user_entered',
    state: 'confirmed',
    reviewed_by: scope.userId,
    reviewed_at: now,
    supersedes_fact_id: latest?.id ?? null,
    created_by: scope.userId,
  });
  if (error) return { error: error.code === '23505' ? 'Someone changed this fact at the same time. Refresh and try again.' : 'Could not save the fact.' };
  refresh(scope.applicationId);
  return { message: 'Saved.' };
}
