import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from './config';

// Thin REST client for Voyage AI's embeddings endpoint (PHASE_0_FINDINGS.md
// SS5: Anthropic serves no embeddings endpoint). No @anthropic-ai/sdk-style
// SDK is installed for Voyage (confirmed via package.json) and none is added
// here -- a single JSON POST doesn't justify a new dependency.
//
// Callers are responsible for checking lib/flags.ts's isVectorRetrievalEnabled()
// before calling this module at all -- this file has no opinion on the flag,
// it just performs the HTTP call when asked. Keeping the gate at the call
// site (lib/ai/retrieve-code-chunks.ts) rather than in here means this module
// stays a plain, flag-agnostic API client.
const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';

// 'query' embeds a search query (the audit retrieval use case this file was
// built for); 'document' embeds a corpus chunk at ingestion time. Voyage
// asymmetrically optimizes each mode's embedding for retrieval accuracy, so
// picking the wrong one silently degrades ranking rather than erroring --
// callers must be explicit, there is no default.
export type VoyageInputType = 'query' | 'document';

interface VoyageEmbeddingsResponse {
  object: string;
  data: Array<{ object: string; embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

/**
 * Embeds a single text string via Voyage AI, returning a vector of exactly
 * EMBEDDING_DIMENSIONS length. Throws on any transport/API error or on a
 * dimension mismatch -- a silently wrong-length vector would either fail the
 * pgvector column insert loudly (good) or, worse, get truncated/padded by
 * some layer and corrupt retrieval quietly (bad), so this checks explicitly
 * rather than trusting the provider response shape.
 */
export async function embedText(text: string, inputType: VoyageInputType): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set; cannot call Voyage embeddings API.');
  }
  if (text.trim().length === 0) {
    throw new Error('embedText requires non-empty text.');
  }

  const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL_ID,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(`Voyage embeddings API returned ${response.status}: ${body}`);
  }

  const parsed = (await response.json()) as VoyageEmbeddingsResponse;
  const embedding = parsed.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Voyage embeddings API response contained no embedding.');
  }
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Voyage embeddings API returned a ${embedding.length}-dimension vector; expected ${EMBEDDING_DIMENSIONS} (EMBEDDING_MODEL_ID=${EMBEDDING_MODEL_ID}). jurisdiction_code_chunks.embedding is declared vector(${EMBEDDING_DIMENSIONS}) -- a mismatch here means the model/dims constants in lib/ai/config.ts are out of sync with the provider.`
    );
  }

  return embedding;
}

/**
 * Formats a pgvector literal string (e.g. "[0.1,0.2,...]") from an embedding
 * array. pg/postgrest clients don't know how to serialize a JS number[] into
 * pgvector's input syntax on their own, so every call site that passes an
 * embedding into a query needs this -- centralized here instead of
 * duplicated per call site.
 */
export function toPgvectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
