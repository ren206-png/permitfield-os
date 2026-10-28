import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_DOCUMENT_MAX_RETRIEVED_CHUNKS } from './config';

/**
 * Gate AI-1, sub-phase AI-1.2 (GATE_AI_1_FINDINGS.md §C, §G, §H
 * CROSS_TENANT_RAG). Mirrors lib/ai/retrieve-code-chunks.ts exactly, but over
 * the NEW application_document_chunks table / search_application_document_chunks
 * RPC (20260806000038_application_document_chunks.sql) instead of the public
 * jurisdiction_code_chunks corpus -- retrieval over an org's OWN uploaded
 * application documents, scoped by org_id AND application_id.
 *
 * Rows are written by lib/inngest/functions/ingest-document-chunks.ts (behind
 * PERMITFIELD_FF_ORG_DOCUMENT_RETRIEVAL). The caller is
 * lib/sources/evidence.ts's buildEvidenceBundle (Gate 6.3), which labels
 * these chunks as contractor documents, never as official requirements;
 * that bundle's first consumer is the 6.4 copilot.
 */
export interface RetrievedOrgDocumentChunk {
  id: string;
  applicationDocumentId: string;
  chunkIndex: number;
  content: string;
  rrfScore: number;
}

/**
 * Calls search_application_document_chunks (migration 20260806000038) to
 * fetch the top ORG_DOCUMENT_MAX_RETRIEVED_CHUNKS chunks for one org's one
 * application, ranked by BM25 keyword search only -- same as retrieveCodeChunks above.
 *
 * p_org_id and p_application_id are BOTH required and passed straight through
 * from the caller -- this is the CROSS_TENANT_RAG defense-in-depth the RPC's
 * own header describes: even under service_role (BYPASSRLS, the role every
 * real caller of this RPC in this codebase would run as, same as
 * search_jurisdiction_code_chunks), the RPC's explicit org_id/application_id
 * WHERE-clause filters still block a cross-tenant or cross-application
 * result. Never derive orgId/applicationId from anything other than the
 * caller's own already-authorized context (e.g. the permit_applications row
 * a background job is already scoped to) -- do not accept them from
 * unauthenticated input.
 *
 * An empty corpus returns [], not an error.
 */
export async function retrieveOrgDocumentChunks(
  supabase: SupabaseClient,
  orgId: string,
  applicationId: string,
  queryText: string
): Promise<RetrievedOrgDocumentChunk[]> {
  const { data, error } = await supabase.rpc('search_application_document_chunks', {
    p_org_id: orgId,
    p_application_id: applicationId,
    p_query_text: queryText,
    p_query_embedding: null,
    p_match_count: ORG_DOCUMENT_MAX_RETRIEVED_CHUNKS,
  });

  if (error) {
    throw new Error(`search_application_document_chunks RPC failed: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    id: string;
    application_document_id: string;
    chunk_index: number;
    content: string;
    rrf_score: number;
  }>).map((row) => ({
    id: row.id,
    applicationDocumentId: row.application_document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    rrfScore: row.rrf_score,
  }));
}
