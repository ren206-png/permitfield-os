'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { COPILOT_MAX_MESSAGE_CHARS, COPILOT_MAX_TURNS } from '@/lib/ai/config';
import { proposalsFromExtraction } from '@/lib/ai/copilot/facts-from-extraction';
import { runCopilotTurn, type StopReason, type ToolCallRecord } from '@/lib/ai/copilot/orchestrator';
import { anthropicCopilotProvider } from '@/lib/ai/copilot/provider';
import { COPILOT_TOOLS, EvidenceRegistry } from '@/lib/ai/copilot/tools';
import { recordEnteredFact } from '@/lib/requirements/rules/enter-fact';
import { createServiceClient } from '@/lib/supabase/service-client';
import { checkCopilotBudget, factSessionScope, recordFeeEstimate, recordModelCall, recordToolCall, sessionScope } from './server';

// Gate 6.4: the staff copilot's server actions. Every action checks the
// flag, signs the caller in (requireOrgContext), and resolves the
// application with the caller's OWN session -- RLS decides whether it
// exists for them. Tools and fact writes run on that session. Only the
// usage/tool ledgers are written with the service client (service-client.ts
// Exception 9), with ids taken from the resolved scope.

const NOT_AVAILABLE = 'The copilot is not available.';

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
  const blocked = await checkCopilotBudget(service, scope);
  if (blocked) return { ok: false, error: blocked };

  const provider = anthropicCopilotProvider();
  const traceId = randomUUID();
  const evidence = new EvidenceRegistry();
  const turn = await runCopilotTurn({
    provider,
    tools: COPILOT_TOOLS,
    ctx: { supabase, scope, evidence, now: new Date(), recordFeeEstimate: (estimate) => recordFeeEstimate(service, scope, estimate) },
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
  const session = await factSessionScope(formValue(formData, 'applicationId'));
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

// A fact typed in by staff is confirmed by the person entering it
// (lib/requirements/rules/enter-fact.ts).
export async function enterFactAction(_prev: FactActionState, formData: FormData): Promise<FactActionState> {
  const session = await factSessionScope(formValue(formData, 'applicationId'));
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  if (!scope.projectId) return { error: 'This application is not linked to a project, so facts cannot be recorded for it.' };

  const result = await recordEnteredFact(
    supabase,
    { orgId: scope.orgId, projectId: scope.projectId, userId: scope.userId },
    formValue(formData, 'factKey'),
    formValue(formData, 'value')
  );
  if (!result.ok) return { error: result.error };
  refresh(scope.applicationId);
  return { message: 'Saved.' };
}
