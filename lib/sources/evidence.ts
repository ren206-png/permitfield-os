import type { SupabaseClient } from '@supabase/supabase-js';
import { retrieveOrgDocumentChunks } from '@/lib/ai/retrieve-org-document-chunks';
import { isOrgDocumentRetrievalEnabled } from '@/lib/flags';
import { computeFreshness, type Freshness, type SourceType } from './freshness';

// Gate 6.3: the evidence bundle a model may cite (master prompt §11).
// Official material comes from search_source_evidence (published source
// revisions only, exact jurisdiction and effective-date filters applied in
// SQL before anything reaches a model). Contractor material comes from the
// org's own uploaded documents via retrieveOrgDocumentChunks, kept as a
// separate kind so a contractor's document is never presented as an
// official requirement. Each item gets a short evidence id ("S1", "D1")
// that citations must refer to (see citations.ts).
//
// Scope: jurisdictionId / orgId / applicationId must come from a row the
// caller already read under its own authorization (e.g. the RLS-visible
// permit_applications row) -- never from model output.

export const MAX_OFFICIAL_EVIDENCE = 8;

export type EvidenceItem =
  | {
      evidenceId: string;
      kind: 'official_source';
      content: string;
      locator: string;
      sourceRevisionId: string;
      sourceId: string;
      sourceType: SourceType;
      url: string;
      title: string;
      issuingBody: string;
      revisionNumber: number;
      publishedOn: string | null;
      effectiveFrom: string | null;
      effectiveTo: string | null;
      retrievedAt: string;
      accessScope: 'public' | 'public_no_redistribution' | 'licensed_internal';
      lastCheckedAt: string | null;
      freshness: Freshness;
    }
  | {
      evidenceId: string;
      kind: 'contractor_document';
      content: string;
      locator: string;
      applicationDocumentId: string;
      chunkIndex: number;
    };

export interface EvidenceBundle {
  asOf: string;
  items: EvidenceItem[];
}

interface SourceEvidenceRow {
  chunk_id: string;
  source_revision_id: string;
  source_id: string;
  source_type: SourceType;
  source_url: string;
  title: string;
  issuing_body: string;
  revision_number: number;
  locator: string;
  content: string;
  published_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  retrieved_at: string;
  access_scope: 'public' | 'public_no_redistribution' | 'licensed_internal';
  last_checked_at: string | null;
}

export async function searchOfficialSources(
  supabase: SupabaseClient,
  params: { jurisdictionId: string; queryText: string; asOf: string; now?: Date }
): Promise<Extract<EvidenceItem, { kind: 'official_source' }>[]> {
  const { data, error } = await supabase.rpc('search_source_evidence', {
    p_jurisdiction_id: params.jurisdictionId,
    p_query_text: params.queryText,
    p_as_of: params.asOf,
    p_match_count: MAX_OFFICIAL_EVIDENCE,
  });
  if (error) throw new Error(`search_source_evidence RPC failed: ${error.message}`);
  return ((data ?? []) as SourceEvidenceRow[]).map((row, i) => ({
    evidenceId: `S${i + 1}`,
    kind: 'official_source' as const,
    content: row.content,
    locator: row.locator,
    sourceRevisionId: row.source_revision_id,
    sourceId: row.source_id,
    sourceType: row.source_type,
    url: row.source_url,
    title: row.title,
    issuingBody: row.issuing_body,
    revisionNumber: row.revision_number,
    publishedOn: row.published_on,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    retrievedAt: row.retrieved_at,
    accessScope: row.access_scope,
    lastCheckedAt: row.last_checked_at,
    freshness: computeFreshness(row.source_type, row.last_checked_at, params.now),
  }));
}

export async function buildEvidenceBundle(
  supabase: SupabaseClient,
  params: { jurisdictionId: string; orgId: string; applicationId: string | null; queryText: string; asOf: string; now?: Date }
): Promise<EvidenceBundle> {
  const official = await searchOfficialSources(supabase, params);
  const contractor =
    params.applicationId && isOrgDocumentRetrievalEnabled()
      ? (await retrieveOrgDocumentChunks(supabase, params.orgId, params.applicationId, params.queryText)).map((chunk, i) => ({
          evidenceId: `D${i + 1}`,
          kind: 'contractor_document' as const,
          content: chunk.content,
          locator: `Uploaded document, part ${chunk.chunkIndex + 1}`,
          applicationDocumentId: chunk.applicationDocumentId,
          chunkIndex: chunk.chunkIndex,
        }))
      : [];
  return { asOf: params.asOf, items: [...official, ...contractor] };
}
