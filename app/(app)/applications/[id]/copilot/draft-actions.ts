'use server';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { COPILOT_CALL_TIMEOUT_MS } from '@/lib/ai/config';
import { generateDraft, type DraftRequest } from '@/lib/ai/copilot/drafting';
import { anthropicCopilotProvider } from '@/lib/ai/copilot/provider';
import { candidateDocuments, CorrectionItemsSchema } from '@/lib/drafts/correction';
import { decideAiWrite, decideHumanSave, latestVersion, type DraftVersionRow } from '@/lib/drafts/versions';
import { estimateApplicationFees } from '@/lib/fees/load';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import { createServiceClient } from '@/lib/supabase/service-client';
import { checkCopilotBudget, recordFeeEstimate, recordModelCall, sessionScope } from './server';

// Gate 6.5: drafts (cover letter, correction responses), correction
// requests and fee estimates on the copilot page. Same rules as actions.ts:
// flag + sign-in + scope from the caller's own session; drafts and requests
// are written with that session (RLS: members, created_by = auth.uid());
// usage and estimate snapshots go to the server-only ledgers.

export interface DraftActionState {
  error?: string;
  message?: string;
  // An AI draft that was NOT saved because the latest version is a human
  // edit: shown beside the editor; the person decides what to keep.
  suggestion?: string;
  itemsWithoutEvidence?: number[];
}

const NOT_AVAILABLE = 'The copilot is not available.';
const formValue = (formData: FormData, key: string) => String(formData.get(key) ?? '');
const refresh = (applicationId: string) => revalidatePath(`/applications/${applicationId}/copilot`);

const ThreadSchema = z.object({
  applicationId: z.guid(),
  kind: z.enum(['cover_letter', 'correction_response']),
  threadId: z.union([z.guid(), z.literal('')]),
  correctionRequestId: z.union([z.guid(), z.literal('')]),
});

function threadFrom(formData: FormData) {
  return ThreadSchema.safeParse({
    applicationId: formValue(formData, 'applicationId'),
    kind: formValue(formData, 'kind'),
    threadId: formValue(formData, 'threadId'),
    correctionRequestId: formValue(formData, 'correctionRequestId'),
  });
}

async function threadVersions(supabase: SupabaseClient, orgId: string, threadId: string): Promise<DraftVersionRow[]> {
  if (!threadId) return [];
  const { data } = await supabase.from('application_draft_versions').select('thread_id, version, origin, body, created_at').eq('org_id', orgId).eq('thread_id', threadId);
  return (data ?? []) as DraftVersionRow[];
}

export async function recordCorrectionRequestAction(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const session = await sessionScope(formValue(formData, 'applicationId'));
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  const receivedOn = z.iso.date().safeParse(formValue(formData, 'receivedOn'));
  const items = CorrectionItemsSchema.safeParse(
    formValue(formData, 'items')
      .split('\n')
      .map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim())
      .filter(Boolean)
  );
  const reference = formValue(formData, 'reference').trim().slice(0, 200);
  if (!receivedOn.success) return { error: 'Enter the date the request was received.' };
  if (!items.success) return { error: 'List the items, one per line (up to 100).' };
  const { error } = await supabase.from('correction_requests').insert({
    org_id: scope.orgId,
    application_id: scope.applicationId,
    received_on: receivedOn.data,
    reference: reference || null,
    items: items.data,
    recorded_by: scope.userId,
  });
  if (error) return { error: 'Could not record the correction request.' };
  refresh(scope.applicationId);
  return { message: `Recorded ${items.data.length} item${items.data.length === 1 ? '' : 's'}.` };
}

export async function saveDraftAction(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const t = threadFrom(formData);
  if (!t.success) return { error: 'Invalid draft.' };
  const session = await sessionScope(t.data.applicationId);
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  const body = z.string().trim().min(1).max(50000).safeParse(formValue(formData, 'body'));
  if (!body.success) return { error: 'The draft is empty or too long.' };
  const base = formValue(formData, 'baseVersion');
  const baseVersion = base === '' ? null : Number(base);

  const threadId = t.data.threadId || randomUUID();
  const decision = decideHumanSave(latestVersion(await threadVersions(supabase, scope.orgId, t.data.threadId)), baseVersion);
  if (!decision.ok) return { error: 'Someone saved a newer version while you were editing. Copy your text, reload, and save again.' };

  const { error } = await supabase.from('application_draft_versions').insert({
    org_id: scope.orgId,
    application_id: scope.applicationId,
    thread_id: threadId,
    kind: t.data.kind,
    correction_request_id: t.data.correctionRequestId || null,
    version: decision.version,
    based_on_version: decision.basedOn,
    origin: 'human_edited',
    body: body.data,
    created_by: scope.userId,
  });
  if (error) {
    return { error: error.code === '23505' ? 'Someone saved a newer version at the same moment. Copy your text, reload, and save again.' : 'Could not save the draft.' };
  }
  refresh(scope.applicationId);
  return { message: `Saved as version ${decision.version}.` };
}

export async function generateDraftAction(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const t = threadFrom(formData);
  if (!t.success) return { error: 'Invalid draft.' };
  const session = await sessionScope(t.data.applicationId);
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  const service = createServiceClient();
  const blocked = await checkCopilotBudget(service, scope);
  if (blocked) return { error: blocked };

  const [{ data: application }, { data: documents }] = await Promise.all([
    supabase.from('permit_applications').select('project_title, project_address, estimated_job_value_cents').eq('id', scope.applicationId).maybeSingle(),
    supabase.from('application_documents').select('id, original_filename, doc_kind, uploaded_at').eq('application_id', scope.applicationId),
  ]);
  const docs = (documents ?? []).map((d) => ({ id: d.id, filename: d.original_filename, kind: d.doc_kind, uploadedAt: d.uploaded_at }));
  const applicationInfo = {
    title: application?.project_title,
    address: application?.project_address,
    permit_type: scope.permitTypeTitle,
    municipality: scope.jurisdictionName,
  };

  let request: DraftRequest;
  if (t.data.kind === 'correction_response') {
    const { data: correction } = await supabase
      .from('correction_requests')
      .select('id, received_on, reference, items')
      .eq('id', t.data.correctionRequestId || '00000000-0000-0000-0000-000000000000')
      .eq('org_id', scope.orgId)
      .eq('application_id', scope.applicationId)
      .maybeSingle();
    const items = correction ? CorrectionItemsSchema.safeParse(correction.items) : null;
    if (!correction || !items?.success) return { error: 'Correction request not found.' };
    request = {
      kind: 'correction_response',
      application: applicationInfo,
      reference: correction.reference,
      receivedOn: correction.received_on,
      items: items.data,
      documents: candidateDocuments(docs, correction.received_on),
    };
  } else {
    const [{ data: factRows }, { data: checklist }] = await Promise.all([
      scope.projectId
        ? supabase.from('project_facts').select('id, fact_key, value, unit, state, supersedes_fact_id, created_at').eq('org_id', scope.orgId).eq('project_id', scope.projectId)
        : Promise.resolve({ data: [] as ProjectFactRow[] }),
      supabase.from('readiness_checklist_items').select('title, is_required, status').eq('application_id', scope.applicationId),
    ]);
    const facts = Object.fromEntries(
      [...resolveFacts((factRows ?? []) as ProjectFactRow[]).facts].flatMap(([k, f]) => (f.status === 'confirmed' ? [[k, { value: f.value, unit: f.unit }]] : []))
    );
    request = { kind: 'cover_letter', application: applicationInfo, facts, checklist: checklist ?? [], documents: docs };
  }

  const provider = anthropicCopilotProvider();
  const result = await generateDraft(provider, request, AbortSignal.timeout(COPILOT_CALL_TIMEOUT_MS));
  await recordModelCall(service, scope, provider.modelId, result.usage, result.ok ? null : result.error);
  if (!result.ok) {
    return {
      error:
        result.error === 'refusal'
          ? "The copilot can't draft this one."
          : result.error === 'provider'
            ? 'The AI service could not be reached. Your drafts are unchanged; try again shortly.'
            : 'The draft came back incomplete. Try again.',
    };
  }

  const threadId = t.data.threadId || randomUUID();
  const decision = decideAiWrite(latestVersion(await threadVersions(supabase, scope.orgId, t.data.threadId)));
  if (!decision.write) {
    return {
      suggestion: result.body,
      itemsWithoutEvidence: result.itemsWithoutEvidence,
      message: 'Your edited version was kept. The new AI draft is shown beside it; copy what you want and save.',
    };
  }
  const { error } = await supabase.from('application_draft_versions').insert({
    org_id: scope.orgId,
    application_id: scope.applicationId,
    thread_id: threadId,
    kind: t.data.kind,
    correction_request_id: t.data.correctionRequestId || null,
    version: decision.version,
    based_on_version: decision.basedOn,
    origin: 'ai_generated',
    body: result.body,
    model_id: provider.modelId,
    created_by: scope.userId,
  });
  if (error) return { error: error.code === '23505' ? 'Someone saved at the same moment. Reload and try again.' : 'Could not save the draft.' };
  refresh(scope.applicationId);
  return {
    itemsWithoutEvidence: result.itemsWithoutEvidence,
    message:
      result.itemsWithoutEvidence.length > 0
        ? `Drafted as version ${decision.version}. ${result.itemsWithoutEvidence.length} item(s) have no supporting document yet and are marked in the text.`
        : `Drafted as version ${decision.version}. Review and edit before sending.`,
  };
}

export async function estimateFeesAction(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const session = await sessionScope(formValue(formData, 'applicationId'));
  if (!session) return { error: NOT_AVAILABLE };
  const { supabase, scope } = session;
  const estimate = await estimateApplicationFees(supabase, scope);
  await recordFeeEstimate(createServiceClient(), scope, estimate);
  refresh(scope.applicationId);
  return { message: 'Fee estimate updated.' };
}
