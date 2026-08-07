import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText, toPgvectorLiteral } from './embed';
import { isVectorRetrievalEnabled } from '@/lib/flags';
import { AUDIT_MAX_RETRIEVED_CHUNKS } from './config';
import type { PermitExtraction } from './schemas/extraction';

export interface RetrievedCodeChunk {
  id: string;
  codeSection: string;
  content: string;
  sourceUrl: string;
  effectiveDate: string | null;
  corpusVersion: string;
  rrfScore: number;
}

/**
 * Builds the natural-language query text used for BOTH retrieval modes
 * (BM25's plainto_tsquery and, when enabled, the embedding). Deliberately
 * built only from fields the model already extracted with a non-null value
 * (SS4.2: a field can be present-but-uncertain OR absent, never guessed) --
 * a null field is simply omitted from the query rather than padded with a
 * placeholder, so an application missing (say) an electrical_amps reading
 * doesn't pollute retrieval with noise like "null amps".
 */
export function buildAuditQueryText(params: {
  permitTypeTitle: string;
  extraction: PermitExtraction;
}): string {
  const { permitTypeTitle, extraction } = params;
  const parts: string[] = [permitTypeTitle];

  if (extraction.scope_of_work_summary.value) {
    parts.push(extraction.scope_of_work_summary.value);
  }
  if (extraction.square_footage.value !== null) {
    parts.push(`${extraction.square_footage.value} square metres`);
  }
  if (extraction.electrical_amps.value !== null) {
    parts.push(`${extraction.electrical_amps.value} amp electrical service`);
  }

  return parts.join('. ');
}

/**
 * Calls search_jurisdiction_code_chunks (migration 20260806000014) to fetch
 * the top AUDIT_MAX_RETRIEVED_CHUNKS code chunks for one jurisdiction, fused
 * via RRF across BM25 and (when isVectorRetrievalEnabled()) vector ranking.
 *
 * NOTE: the vector half of this path (embedText + the p_query_embedding RPC
 * argument) has not been exercised against a live Voyage API key or a
 * non-empty jurisdiction_code_chunks table in this environment -- no
 * VOYAGE_API_KEY is available here, and no corpus ingestion pipeline exists
 * yet in any phase, so there are zero real chunks to retrieve regardless.
 * isVectorRetrievalEnabled() defaults OFF for exactly this reason (see
 * lib/flags.ts), so the BM25-only path is what actually runs today. Both
 * paths return an empty array, not an error, when no chunk matches -- an
 * empty corpus is a valid, expected state pre-ingestion, not a failure.
 */
export async function retrieveCodeChunks(
  supabase: SupabaseClient,
  jurisdictionId: string,
  queryText: string
): Promise<RetrievedCodeChunk[]> {
  let queryEmbeddingLiteral: string | null = null;
  if (isVectorRetrievalEnabled()) {
    const embedding = await embedText(queryText, 'query');
    queryEmbeddingLiteral = toPgvectorLiteral(embedding);
  }

  const { data, error } = await supabase.rpc('search_jurisdiction_code_chunks', {
    p_jurisdiction_id: jurisdictionId,
    p_query_text: queryText,
    p_query_embedding: queryEmbeddingLiteral,
    p_match_count: AUDIT_MAX_RETRIEVED_CHUNKS,
  });

  if (error) {
    throw new Error(`search_jurisdiction_code_chunks RPC failed: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    id: string;
    code_section: string;
    content: string;
    source_url: string;
    effective_date: string | null;
    corpus_version: string;
    rrf_score: number;
  }>).map((row) => ({
    id: row.id,
    codeSection: row.code_section,
    content: row.content,
    sourceUrl: row.source_url,
    effectiveDate: row.effective_date,
    corpusVersion: row.corpus_version,
    rrfScore: row.rrf_score,
  }));
}
