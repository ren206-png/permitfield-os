'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/org-context';
import { ALL_PERMIT_STATUSES } from '@/lib/permit-status/transitions';
import { isPermitLifecycleEnabled } from '@/lib/flags';
import { buildManifest } from '@/lib/packages/manifest';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import { createClient } from '@/lib/supabase/server';

// Gate 6.6: the permit lifecycle panel's actions. Every action checks the
// flag, signs the caller in, and writes with the caller's own session: RLS
// (is_org_member, actor = auth.uid()) and record_status_observation's own
// checks (including transition_permit_status's role tiers) decide what is
// allowed. The org id written is the application's, read through RLS.

export interface LifecycleState {
  error?: string;
  message?: string;
}

const value = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const OUTCOME_MESSAGE: Record<string, string> = {
  applied: 'Recorded, and the permit status was updated.',
  already_current: 'Recorded. The status was already this.',
  stale: 'Recorded as history only: it is older than the newest status on file, so it did not change anything.',
  not_applied_invalid: 'Recorded, but the status was not changed (not a valid next step from the current status).',
  recorded_only: 'Recorded. The wording does not map to a PermitField status, so the status was not changed.',
};

async function context(applicationId: string) {
  if (!isPermitLifecycleEnabled()) return null;
  const { userId } = await requireOrgContext();
  if (!z.guid().safeParse(applicationId).success) return null;
  const supabase = await createClient();
  const { data: app } = await supabase
    .from('permit_applications')
    .select('id, org_id, project_id, project_title, project_address, permit_status, permit_types ( title, jurisdictions ( municipality, province_code ) )')
    .eq('id', applicationId)
    .maybeSingle();
  return app ? { supabase, userId, app } : null;
}

const done = (applicationId: string, message: string): LifecycleState => {
  revalidatePath(`/applications/${applicationId}`);
  return { message };
};

export async function recordStatusAction(_prev: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const ctx = await context(value(formData, 'applicationId'));
  if (!ctx) return { error: 'Not available.' };
  const parsed = z
    .object({
      source: z.enum(['authority_correspondence', 'user_reported']),
      externalStatus: z.string().min(1, 'Enter the authority’s wording.').max(500),
      observedStatus: z.union([z.enum(ALL_PERMIT_STATUSES as [string, ...string[]]), z.literal('')]),
      observedOn: z.iso.date(),
      reference: z.string().max(200),
    })
    .safeParse({
      source: value(formData, 'source'),
      externalStatus: value(formData, 'externalStatus'),
      observedStatus: value(formData, 'observedStatus'),
      observedOn: value(formData, 'observedOn'),
      reference: value(formData, 'reference'),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc('record_status_observation', {
    p_application_id: ctx.app.id,
    p_source: v.source,
    p_external_status: v.externalStatus,
    p_observed_status: v.observedStatus || null,
    // The date the authority gave it, at noon UTC so it sorts inside that day.
    p_observed_at: `${v.observedOn}T12:00:00Z`,
    p_evidence_document_id: null,
    p_external_reference: v.reference || null,
    p_request_key: randomUUID(),
  });
  if (error) return { error: error.code === '42501' ? 'Your role cannot record this status.' : 'Could not record the status.' };
  return done(ctx.app.id, OUTCOME_MESSAGE[(data as { outcome: string }).outcome] ?? 'Recorded.');
}

export async function addConditionAction(_prev: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const ctx = await context(value(formData, 'applicationId'));
  if (!ctx) return { error: 'Not available.' };
  const text = z.string().min(1).max(4000).safeParse(value(formData, 'conditionText'));
  const category = z.enum(['before_issuance', 'during_construction', 'before_occupancy', 'inspection', 'other']).safeParse(value(formData, 'category'));
  if (!text.success || !category.success) return { error: 'Enter the condition and its category.' };
  const { error } = await ctx.supabase.from('permit_conditions').insert({
    org_id: ctx.app.org_id,
    application_id: ctx.app.id,
    condition_text: text.data,
    category: category.data,
    source: 'authority_correspondence',
    recorded_by: ctx.userId,
  });
  return error ? { error: 'Could not record the condition.' } : done(ctx.app.id, 'Condition recorded.');
}

export async function conditionEventAction(_prev: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const ctx = await context(value(formData, 'applicationId'));
  if (!ctx) return { error: 'Not available.' };
  const conditionId = z.guid().safeParse(value(formData, 'conditionId'));
  const status = z.enum(['satisfied', 'waived_by_authority', 'reopened']).safeParse(value(formData, 'status'));
  const note = value(formData, 'note').slice(0, 2000);
  if (!conditionId.success || !status.success) return { error: 'Invalid condition.' };
  if (status.data !== 'reopened' && !note) return { error: 'Add a note: how it was satisfied, or who waived it and when.' };
  const { error } = await ctx.supabase.from('permit_condition_events').insert({
    org_id: ctx.app.org_id,
    condition_id: conditionId.data,
    status: status.data,
    note: note || null,
    recorded_by: ctx.userId,
  });
  return error ? { error: 'Could not update the condition.' } : done(ctx.app.id, 'Condition updated.');
}

export async function recordInspectionAction(_prev: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const ctx = await context(value(formData, 'applicationId'));
  if (!ctx) return { error: 'Not available.' };
  const parsed = z
    .object({
      inspectionType: z.string().min(1).max(200),
      outcome: z.enum(['scheduled', 'passed', 'failed', 'partial', 'cancelled']),
      occurredOn: z.iso.date(),
      provenance: z.enum(['authority_record', 'user_reported']),
      notes: z.string().max(4000),
    })
    .safeParse({
      inspectionType: value(formData, 'inspectionType'),
      outcome: value(formData, 'outcome'),
      occurredOn: value(formData, 'occurredOn'),
      provenance: value(formData, 'provenance'),
      notes: value(formData, 'notes'),
    });
  if (!parsed.success) return { error: 'Check the inspection details.' };
  const v = parsed.data;
  const { error } = await ctx.supabase.from('inspection_records').insert({
    org_id: ctx.app.org_id,
    application_id: ctx.app.id,
    inspection_type: v.inspectionType,
    outcome: v.outcome,
    occurred_on: v.occurredOn,
    provenance: v.provenance,
    notes: v.notes || null,
    recorded_by: ctx.userId,
  });
  if (error) return { error: error.code === '23514' ? 'Record the permit as issued before recording an inspection result.' : 'Could not record the inspection.' };
  return done(ctx.app.id, 'Inspection recorded.');
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function preparePackageAction(_prev: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const ctx = await context(value(formData, 'applicationId'));
  if (!ctx) return { error: 'Not available.' };
  const { supabase, app, userId } = ctx;
  const [forms, documents, checklist, facts, snapshots, estimate, versions] = await Promise.all([
    supabase.from('generated_documents').select('id, permit_type_filing_id, original_filename, fill_method, created_at, incomplete_required_fields').eq('application_id', app.id),
    supabase.from('application_documents').select('id, original_filename, doc_kind, sha256, byte_size, uploaded_at').eq('application_id', app.id),
    supabase.from('readiness_checklist_items').select('title, is_required, status').eq('application_id', app.id).order('created_at'),
    app.project_id
      ? supabase.from('project_facts').select('id, fact_key, value, unit, state, supersedes_fact_id, created_at').eq('org_id', app.org_id).eq('project_id', app.project_id)
      : Promise.resolve({ data: [] as ProjectFactRow[] }),
    app.project_id
      ? supabase.from('project_requirement_snapshots').select('outcome, evaluated_at').eq('org_id', app.org_id).eq('project_id', app.project_id).order('evaluated_at', { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as { outcome: string; evaluated_at: string }[] }),
    supabase.from('fee_estimates').select('status, total_minor, currency, computed_at').eq('application_id', app.id).order('computed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('submission_packages').select('version').eq('application_id', app.id).order('version', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const documentIds = (documents.data ?? []).map((d) => d.id);
  const revisions = documentIds.length
    ? await supabase
        .from('document_revisions')
        .select('application_document_id, revision_number')
        .in('application_document_id', documentIds)
        .order('revision_number', { ascending: false })
    : { data: [] as { application_document_id: string; revision_number: number }[] };
  const latestRevision = new Map<string, number>();
  for (const r of revisions.data ?? []) if (!latestRevision.has(r.application_document_id)) latestRevision.set(r.application_document_id, r.revision_number);
  const resolved = resolveFacts((facts.data ?? []) as ProjectFactRow[]);
  const latestAt = snapshots.data?.[0]?.evaluated_at ?? null;
  const batch = (snapshots.data ?? []).filter((s) => s.evaluated_at === latestAt);
  const permitType = one(app.permit_types as unknown as { title: string; jurisdictions: unknown } | null);
  const jurisdiction = one(permitType?.jurisdictions as { municipality: string; province_code: string } | null);

  const { manifest, sha256 } = buildManifest({
    application: {
      id: app.id,
      title: app.project_title,
      address: app.project_address,
      permitType: permitType?.title ?? 'unknown',
      municipality: jurisdiction ? `${jurisdiction.municipality}, ${jurisdiction.province_code}` : 'unknown',
      permitStatus: app.permit_status,
    },
    forms: (forms.data ?? []).map((f) => ({
      id: f.id,
      filingId: f.permit_type_filing_id,
      filename: f.original_filename,
      fillMethod: f.fill_method,
      createdAt: f.created_at,
      incompleteRequired: Array.isArray(f.incomplete_required_fields) ? (f.incomplete_required_fields as unknown[]).map(String) : [],
    })),
    attachments: (documents.data ?? []).map((d) => ({
      id: d.id,
      filename: d.original_filename,
      kind: d.doc_kind,
      sha256: d.sha256,
      byteSize: Number(d.byte_size),
      revision: latestRevision.get(d.id) ?? null,
      uploadedAt: d.uploaded_at,
    })),
    confirmedFacts: [...resolved.facts].flatMap(([key, f]) => (f.status === 'confirmed' ? [{ key, value: f.value, unit: f.unit, factId: f.factId }] : [])),
    factsAwaitingConfirmation: [...resolved.facts].filter(([, f]) => f.status === 'awaiting_confirmation').map(([k]) => k).concat(resolved.pendingProposals),
    checklist: (checklist.data ?? []).map((c) => ({ title: c.title, required: c.is_required, status: c.status })),
    ruleCheck: latestAt
      ? {
          evaluatedAt: latestAt,
          applicable: batch.filter((s) => s.outcome === 'applicable').length,
          notApplicable: batch.filter((s) => s.outcome === 'not_applicable').length,
          unknown: batch.filter((s) => s.outcome === 'unknown').length,
        }
      : null,
    feeEstimate: estimate.data
      ? { status: estimate.data.status, totalMinor: estimate.data.total_minor === null ? null : Number(estimate.data.total_minor), currency: estimate.data.currency, computedAt: estimate.data.computed_at }
      : null,
    preparedBy: userId,
    preparedAt: new Date().toISOString(),
  });

  const version = (versions.data?.version ?? 0) + 1;
  const { error } = await supabase.from('submission_packages').insert({
    org_id: app.org_id,
    application_id: app.id,
    version,
    manifest,
    manifest_sha256: sha256,
    prepared_by: userId,
  });
  if (error) return { error: error.code === '23505' ? 'Someone prepared a package at the same moment. Reload and try again.' : 'Could not prepare the package.' };
  return done(app.id, `Package version ${version} prepared${manifest.unresolved.length ? ` with ${manifest.unresolved.length} open item(s)` : ''}.`);
}

export async function approvePackageAction(_prev: LifecycleState, formData: FormData): Promise<LifecycleState> {
  const ctx = await context(value(formData, 'applicationId'));
  if (!ctx) return { error: 'Not available.' };
  const packageId = z.guid().safeParse(value(formData, 'packageId'));
  if (!packageId.success) return { error: 'Invalid package.' };
  const { error } = await ctx.supabase.from('submission_package_approvals').insert({
    org_id: ctx.app.org_id,
    package_id: packageId.data,
    note: value(formData, 'note').slice(0, 2000) || null,
    approved_by: ctx.userId,
  });
  if (error) return { error: error.code === '23505' ? 'This package is already approved.' : 'Could not approve the package.' };
  return done(ctx.app.id, 'Approved internally. This does not submit anything or change the permit status.');
}
