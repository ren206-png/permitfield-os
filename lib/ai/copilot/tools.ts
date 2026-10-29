import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveAuthorityManually } from '@/lib/jurisdictions/resolve-authority';
import { evaluateApplicationRequirementsWith } from '@/lib/requirements/rules/run';
import { RuleSetItemSnapshotSchema } from '@/lib/requirements/rules/rule-set';
import { FACT_KEYS } from '@/lib/requirements/rules/fact-keys';
import { buildEvidenceBundle, type EvidenceItem } from '@/lib/sources/evidence';
import { candidateDocuments } from '@/lib/drafts/correction';
import { estimateApplicationFees } from '@/lib/fees/load';
import type { FeeEstimate } from '@/lib/fees/estimate';
import { PermitExtractionSchema } from '@/lib/ai/schemas/extraction';
import { resolveFacts, type ProjectFactRow } from '@/lib/requirements/rules/facts';
import type { CopilotScope } from './scope';

// Gate 6.4: the copilot's tools (master prompt §12). Every tool is
// read-only or records only an evaluation snapshot; none changes official
// state. Each runs with the signed-in user's own session client, so RLS
// applies to every read, and inside a CopilotScope resolved server-side --
// tool arguments never carry an org, project or application id, and any id
// a tool does accept (a requirement id) is checked to belong to the scope.
//
// 6.5 added estimate_permit_fees, draft_correction_response and
// propose_application_fields -- all read-only (the fee tool also records
// its estimate snapshot through the server-supplied hook).

export interface ToolContext {
  supabase: SupabaseClient;
  scope: CopilotScope;
  evidence: EvidenceRegistry;
  now: Date;
  // Keeps each computed fee estimate for reconciliation (fee_estimates).
  // Supplied by the server action; estimates are never user-writable.
  recordFeeEstimate?: (estimate: FeeEstimate) => Promise<void>;
}

export type ToolOutcome = { ok: true; data: unknown } | { ok: false; error: string };

export interface CopilotTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(ctx: ToolContext, input: z.infer<S>): Promise<ToolOutcome>;
}

const tool = <S extends z.ZodType>(t: CopilotTool<S>): CopilotTool<S> => t;
const NoInput = z.strictObject({});

// Evidence collected during one question, with ids unique across every
// search in it (S1, S2… official; D1, D2… contractor documents). Citations
// in the final answer are validated against exactly this set.
export class EvidenceRegistry {
  private items: EvidenceItem[] = [];
  private official = 0;
  private documents = 0;

  add(found: EvidenceItem[]): EvidenceItem[] {
    return found.map((item) => {
      const existing = this.items.find((e) =>
        item.kind === 'official_source' && e.kind === 'official_source'
          ? e.sourceRevisionId === item.sourceRevisionId && e.locator === item.locator && e.content === item.content
          : item.kind === 'contractor_document' && e.kind === 'contractor_document'
            ? e.applicationDocumentId === item.applicationDocumentId && e.chunkIndex === item.chunkIndex
            : false
      );
      if (existing) return existing;
      const evidenceId = item.kind === 'official_source' ? `S${++this.official}` : `D${++this.documents}`;
      const stored = { ...item, evidenceId };
      this.items.push(stored);
      return stored;
    });
  }

  bundle(asOf: string) {
    return { asOf, items: [...this.items] };
  }
}

const today = (now: Date) => now.toISOString().slice(0, 10);

export const resolveProjectAuthorities = tool({
  name: 'resolve_project_authorities',
  description:
    "Who issues permits for this application's location: the municipality the user chose for the application and the authorities recorded for it, with PermitField's coverage level there. Never guesses a different or nearby municipality.",
  input: NoInput,
  async run({ supabase, scope }) {
    const [{ data: jurisdiction }, { data: authorities, error }] = await Promise.all([
      supabase.from('jurisdictions').select('id, country, province_code, municipality, coverage_level').eq('id', scope.jurisdictionId).maybeSingle(),
      supabase.from('authorities').select('id, name, authority_level, province_code, jurisdiction_id, filing_mechanism').eq('jurisdiction_id', scope.jurisdictionId),
    ]);
    if (error) return { ok: false, error: 'Could not read authorities.' };
    if (!jurisdiction) return { ok: false, error: 'The application has no readable municipality.' };
    // The location was confirmed by the user when they chose the city for
    // the application (D5: manual confirmation only).
    const resolution = resolveAuthorityManually({
      confirmedJurisdictionId: jurisdiction.id,
      jurisdictions: [
        {
          id: jurisdiction.id,
          country: jurisdiction.country,
          provinceCode: jurisdiction.province_code,
          municipality: jurisdiction.municipality,
          coverageLevel: jurisdiction.coverage_level,
        },
      ],
      authorities: (authorities ?? []).map((a) => ({ id: a.id, name: a.name, jurisdictionId: a.jurisdiction_id, provinceCode: a.province_code })),
    });
    return {
      ok: true,
      data: {
        municipality: `${jurisdiction.municipality}, ${jurisdiction.province_code}`,
        coverage_level: jurisdiction.coverage_level,
        resolution: resolution.status,
        authorities: (authorities ?? []).map((a) => ({ name: a.name, level: a.authority_level, filing: a.filing_mechanism })),
        note: 'Location as chosen by the user for this application. Coverage "listed" or "assisted" means PermitField has not verified every requirement there.',
      },
    };
  },
});

export const getPermitRequirements = tool({
  name: 'get_permit_requirements',
  description:
    "The requirement catalogue for this application's permit type in its municipality, with each item's review status and source, plus whether a rule set is published. Exactly this permit type; never another municipality's list.",
  input: NoInput,
  async run({ supabase, scope }) {
    const [{ data: requirements, error }, { data: ruleSet }] = await Promise.all([
      supabase
        .from('permit_requirements')
        .select('id, title, description, applies_when, verification_status, verified_at, jurisdiction_sources ( url )')
        .eq('permit_type_id', scope.permitTypeId)
        .is('archived_at', null)
        .order('display_order', { ascending: true, nullsFirst: false }),
      supabase
        .from('rule_set_versions')
        .select('version, published_at')
        .eq('permit_type_id', scope.permitTypeId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (error) return { ok: false, error: 'Could not read requirements.' };
    return {
      ok: true,
      data: {
        permit_type: scope.permitTypeTitle,
        municipality: scope.jurisdictionName,
        published_rule_set: ruleSet ? { version: ruleSet.version, published_at: ruleSet.published_at } : null,
        requirements: (requirements ?? []).map((r) => {
          const source = Array.isArray(r.jurisdiction_sources) ? r.jurisdiction_sources[0] : r.jurisdiction_sources;
          return {
            requirement_id: r.id,
            title: r.title,
            description: r.description,
            applies_when: r.applies_when,
            review_status: r.verification_status,
            source_url: (source as { url?: string } | null)?.url ?? null,
          };
        }),
      },
    };
  },
});

export const evaluatePermitApplicability = tool({
  name: 'evaluate_permit_applicability',
  description:
    "Runs the published rule set for this permit type against the project's CONFIRMED facts and records the result. Each requirement comes back applicable, not_applicable or unknown with the reason; unknown is never treated as not required. Lists the facts that would resolve unknowns.",
  input: NoInput,
  async run({ supabase, scope }) {
    const result = await evaluateApplicationRequirementsWith(supabase, scope.userId, scope.applicationId);
    if (!result.ok) {
      const messages: Record<string, string> = {
        disabled: 'Rule evaluation is turned off on this site.',
        no_project: 'This application is not linked to a project, so it has no facts to evaluate.',
        not_found: 'Application not found.',
      };
      return { ok: false, error: messages[result.error] ?? 'Evaluation failed.' };
    }
    const { data: catalogue } = await supabase.from('permit_requirements').select('id, title').eq('permit_type_id', scope.permitTypeId);
    const titles = new Map((catalogue ?? []).map((r) => [r.id, r.title]));
    const missingFacts = new Set<string>();
    for (const o of result.evaluation.outcomes) {
      for (const t of o.trace) if (t.result === 'unknown') missingFacts.add(t.fact);
    }
    return {
      ok: true,
      data: {
        coverage: result.evaluation.coverage,
        summary: result.summary,
        outcomes: result.evaluation.outcomes.map((o) => ({
          requirement_id: o.permitRequirementId,
          title: titles.get(o.permitRequirementId) ?? null,
          outcome: o.outcome,
          reason: o.reason,
          warnings: o.warnings,
        })),
        facts_that_would_help: [...missingFacts].map((key) => ({
          fact_key: key,
          label: (FACT_KEYS as Record<string, { label: string }>)[key]?.label ?? key,
        })),
        facts_awaiting_confirmation: result.pendingProposals,
      },
    };
  },
});

export const searchPermitSources = tool({
  name: 'search_permit_sources',
  description:
    "Full-text search of the official sources PermitField has published for this application's municipality (as in force today), plus this application's own uploaded documents when document search is on. Returns passages with evidence ids (S… official, D… the contractor's own documents) to cite. Keywords work best: form names, section numbers, plain terms.",
  input: z.strictObject({ query: z.string().trim().min(2).max(300) }),
  async run({ supabase, scope, evidence, now }, { query }) {
    const bundle = await buildEvidenceBundle(supabase, {
      jurisdictionId: scope.jurisdictionId,
      orgId: scope.orgId,
      applicationId: scope.applicationId,
      queryText: query,
      asOf: today(now),
      now,
    });
    const items = evidence.add(bundle.items);
    return {
      ok: true,
      data: {
        as_of: bundle.asOf,
        results: items.map((item) =>
          item.kind === 'official_source'
            ? {
                evidence_id: item.evidenceId,
                kind: 'official source',
                title: item.title,
                issuing_body: item.issuingBody,
                locator: item.locator,
                url: item.url,
                effective: `${item.effectiveFrom ?? 'unknown'} to ${item.effectiveTo ?? 'open'}`,
                freshness: item.freshness,
                text: item.content,
              }
            : {
                evidence_id: item.evidenceId,
                kind: "contractor's own uploaded document (not an official requirement)",
                locator: item.locator,
                text: item.content,
              }
        ),
        note: items.length === 0 ? 'No published passage matched. That does not mean nothing applies.' : null,
      },
    };
  },
});

export const explainRequirement = tool({
  name: 'explain_requirement',
  description:
    'One requirement of this permit type in detail: its text, when the source says it applies, the encoded condition and prerequisites from the published rule set (if any), and the official source revision behind it. Cannot change whether it applies.',
  input: z.strictObject({ requirement_id: z.guid() }),
  async run({ supabase, scope }, { requirement_id }) {
    const { data: requirement } = await supabase
      .from('permit_requirements')
      .select('id, title, description, applies_when, verification_status, jurisdiction_sources ( url )')
      .eq('id', requirement_id)
      .eq('permit_type_id', scope.permitTypeId)
      .maybeSingle();
    if (!requirement) return { ok: false, error: 'No such requirement for this permit type.' };

    const { data: ruleSet } = await supabase
      .from('rule_set_versions')
      .select('id, version')
      .eq('permit_type_id', scope.permitTypeId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    let published: unknown = null;
    if (ruleSet) {
      const { data: item } = await supabase
        .from('rule_set_version_items')
        .select('requirement_snapshot, source_revisions ( title, issuing_body, revision_number, effective_from, effective_to )')
        .eq('rule_set_version_id', ruleSet.id)
        .eq('permit_requirement_id', requirement_id)
        .maybeSingle();
      const snapshot = item ? RuleSetItemSnapshotSchema.safeParse(item.requirement_snapshot) : null;
      published = item
        ? {
            rule_set_version: ruleSet.version,
            condition: snapshot?.success ? snapshot.data.condition : 'invalid snapshot',
            prerequisites: snapshot?.success ? snapshot.data.requires : [],
            source_revision: Array.isArray(item.source_revisions) ? (item.source_revisions[0] ?? null) : item.source_revisions,
          }
        : { rule_set_version: ruleSet.version, included: false };
    }
    const source = Array.isArray(requirement.jurisdiction_sources) ? requirement.jurisdiction_sources[0] : requirement.jurisdiction_sources;
    return {
      ok: true,
      data: {
        requirement_id: requirement.id,
        title: requirement.title,
        description: requirement.description,
        applies_when: requirement.applies_when,
        review_status: requirement.verification_status,
        source_url: (source as { url?: string } | null)?.url ?? null,
        published_rule: published,
      },
    };
  },
});

export const assessPackageReadiness = tool({
  name: 'assess_package_readiness',
  description:
    "This application's submission checklist and uploaded documents: which required items are complete, pending or rejected. Completeness is not approval and not code compliance.",
  input: NoInput,
  async run({ supabase, scope }) {
    const [{ data: items, error }, { data: documents }] = await Promise.all([
      supabase
        .from('readiness_checklist_items')
        .select('title, is_required, status, rejection_reason, due_date')
        .eq('application_id', scope.applicationId)
        .order('created_at'),
      supabase.from('application_documents').select('doc_kind, original_filename').eq('application_id', scope.applicationId),
    ]);
    if (error) return { ok: false, error: 'Could not read the checklist.' };
    const list = items ?? [];
    const required = list.filter((i) => i.is_required);
    return {
      ok: true,
      data: {
        required_total: required.length,
        required_complete: required.filter((i) => i.status === 'complete').length,
        items: list.map((i) => ({ title: i.title, required: i.is_required, status: i.status, rejection_reason: i.rejection_reason, due_date: i.due_date })),
        documents: (documents ?? []).map((d) => ({ kind: d.doc_kind, filename: d.original_filename })),
        note: 'A complete checklist means the package has what PermitField tracks. It is not an approval and not a code review.',
      },
    };
  },
});

export const getPermitStatus = tool({
  name: 'get_permit_status',
  description:
    "This application's status as recorded in PermitField, with its history and who changed it when. Not a live check with the city: it is only as current as the last update someone recorded.",
  input: NoInput,
  async run({ supabase, scope }) {
    const [{ data: application }, { data: history }] = await Promise.all([
      supabase.from('permit_applications').select('status, permit_status, updated_at').eq('id', scope.applicationId).maybeSingle(),
      supabase
        .from('application_status_history')
        .select('from_status, to_status, reason, created_at')
        .eq('application_id', scope.applicationId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (!application) return { ok: false, error: 'Application not found.' };
    return {
      ok: true,
      data: {
        processing_status: application.status,
        permit_status: application.permit_status,
        last_updated: application.updated_at,
        history: history ?? [],
        note: 'Recorded in PermitField; not confirmed live with the authority.',
      },
    };
  },
});

export const estimatePermitFees = tool({
  name: 'estimate_permit_fees',
  description:
    "Fee estimate for this application from the published fee schedule, in exact cents, itemized, with status: estimated, missing_inputs, stale_schedule, authority_quote_required or unavailable. Unavailable means no schedule is published -- never that the fee is zero. Taxes and anything listed in exclusions are not included. Quote the figures exactly as returned.",
  input: NoInput,
  async run({ supabase, scope, now, recordFeeEstimate }) {
    const estimate = await estimateApplicationFees(supabase, scope, now);
    await recordFeeEstimate?.(estimate);
    return {
      ok: true,
      data: {
        status: estimate.status,
        currency: estimate.currency,
        total_cents: estimate.totalMinor,
        deposits_cents: estimate.depositsMinor,
        lines: estimate.lines.map((l) => ({ label: l.label, category: l.category, amount_cents: l.amountMinor, calculation: l.calculation })),
        missing_inputs: estimate.missingInputs,
        exclusions: estimate.exclusions,
        assumptions: estimate.assumptions,
        reasons: estimate.reasons,
        schedule_version: estimate.scheduleVersion,
        note: 'An estimate from the published schedule, not the amount the authority will assess.',
      },
    };
  },
});

export const draftCorrectionResponse = tool({
  name: 'draft_correction_response',
  description:
    "The correction requests recorded for this application: each item the authority asked for, the documents uploaded since that request (the only ones that can support a response), and the latest saved response draft. Read-only: drafts are written on the Drafts panel, where every item without a supporting document is marked.",
  input: NoInput,
  async run({ supabase, scope }) {
    const [{ data: requests, error }, { data: documents }, { data: drafts }] = await Promise.all([
      supabase
        .from('correction_requests')
        .select('id, received_on, reference, items')
        .eq('org_id', scope.orgId)
        .eq('application_id', scope.applicationId)
        .order('received_on', { ascending: false }),
      supabase.from('application_documents').select('id, original_filename, doc_kind, uploaded_at').eq('application_id', scope.applicationId),
      supabase
        .from('application_draft_versions')
        .select('correction_request_id, version, origin, body')
        .eq('org_id', scope.orgId)
        .eq('application_id', scope.applicationId)
        .eq('kind', 'correction_response')
        .order('version', { ascending: false }),
    ]);
    if (error) return { ok: false, error: 'Could not read correction requests.' };
    const docs = (documents ?? []).map((d) => ({ id: d.id, filename: d.original_filename, kind: d.doc_kind, uploadedAt: d.uploaded_at }));
    return {
      ok: true,
      data: {
        correction_requests: (requests ?? []).map((r) => {
          const latest = (drafts ?? []).find((d) => d.correction_request_id === r.id) ?? null;
          return {
            received_on: r.received_on,
            reference: r.reference,
            items: r.items,
            documents_since_request: candidateDocuments(docs, r.received_on).map((d) => ({ filename: d.filename, kind: d.kind, uploaded_at: d.uploadedAt })),
            latest_draft: latest ? { version: latest.version, origin: latest.origin, text: latest.body } : null,
          };
        }),
        note: 'A response may say a change was made only where a document uploaded since the request supports it.',
      },
    };
  },
});

// Form fields the existing extraction fills (lib/ai/schemas/extraction.ts)
// that correspond to a project fact.
const FIELD_TO_FACT = [
  { field: 'square_footage', label: 'Floor area (m²) on the form', factKey: 'project.floor_area' },
  { field: 'electrical_amps', label: 'Electrical service (A) on the form', factKey: 'electrical.service_amps' },
] as const;

export const proposeApplicationFields = tool({
  name: 'propose_application_fields',
  description:
    "Compares the values PermitField read from the documents for the city's form with the project's CONFIRMED facts, field by field, and lists where they differ or one is missing. Read-only: it never changes the form or a fact.",
  input: NoInput,
  async run({ supabase, scope }) {
    const [{ data: extraction }, { data: factRows }] = await Promise.all([
      supabase
        .from('extractions')
        .select('parsed_data, created_at')
        .eq('application_id', scope.applicationId)
        .eq('zod_valid', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      scope.projectId
        ? supabase.from('project_facts').select('id, fact_key, value, unit, state, supersedes_fact_id, created_at').eq('org_id', scope.orgId).eq('project_id', scope.projectId)
        : Promise.resolve({ data: [] as ProjectFactRow[] }),
    ]);
    const parsed = extraction ? PermitExtractionSchema.safeParse(extraction.parsed_data) : null;
    const { facts } = resolveFacts((factRows ?? []) as ProjectFactRow[]);
    return {
      ok: true,
      data: {
        extraction_date: extraction?.created_at ?? null,
        fields: FIELD_TO_FACT.map(({ field, label, factKey }) => {
          const formValue = parsed?.success ? parsed.data[field].value : null;
          const fact = facts.get(factKey);
          const factValue = fact?.status === 'confirmed' ? fact.value : null;
          const status =
            formValue === null && factValue === null
              ? 'both_missing'
              : formValue === null
                ? 'form_missing'
                : factValue === null
                  ? 'fact_not_confirmed'
                  : formValue === factValue
                    ? 'matches'
                    : 'differs';
          return { field: label, form_value: formValue, confirmed_fact: factValue, status };
        }),
        note: 'Proposals only. Where they differ, the person decides which is right; nothing is overwritten.',
      },
    };
  },
});

export const COPILOT_TOOLS: readonly CopilotTool[] = [
  resolveProjectAuthorities,
  getPermitRequirements,
  evaluatePermitApplicability,
  searchPermitSources,
  explainRequirement,
  assessPackageReadiness,
  getPermitStatus,
  estimatePermitFees,
  draftCorrectionResponse,
  proposeApplicationFields,
] as CopilotTool[];
