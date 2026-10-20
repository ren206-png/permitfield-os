import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTextDensity } from '@/lib/pdf/text-density';
import { UPLOADS_BUCKET } from '@/lib/storage/documents';
import { chunkText } from './chunk-text';

// Writes application_document_chunks (migration 20260806000038) for one
// application: the ingestion half of org-document retrieval. Runs as
// service_role from lib/inngest/functions/ingest-document-chunks.ts, which
// only calls it when PERMITFIELD_FF_ORG_DOCUMENT_RETRIEVAL is on.
//
// org_id is read from the application row, never from the event payload, so
// a chunk can only ever be stored under the org that owns the application.
// Only text-native PDFs are indexed; scans and images have no text layer
// (they go to the vision path elsewhere). The table is append-only, so a
// document that already has chunks is skipped, not re-chunked.

// A cap on chunks per document bounds embedding spend for a huge upload.
export const MAX_CHUNKS_PER_DOCUMENT = 200;
const INSERT_BATCH_SIZE = 50;

export interface IngestResult {
  documentsIndexed: number;
  documentsSkipped: number;
  chunksWritten: number;
}

export async function ingestApplicationDocumentChunks(
  supabase: SupabaseClient,
  applicationId: string
): Promise<IngestResult> {
  const { data: application, error: appError } = await supabase
    .from('permit_applications')
    .select('id, org_id')
    .eq('id', applicationId)
    .single();
  if (appError || !application) {
    throw new Error(`permit_applications row not found for ${applicationId}: ${appError?.message ?? 'no row'}`);
  }

  const { data: documents, error: docsError } = await supabase
    .from('application_documents')
    .select('id, storage_path, mime_type')
    .eq('application_id', applicationId);
  if (docsError) {
    throw new Error(`Failed to load application_documents for ${applicationId}: ${docsError.message}`);
  }

  const { data: existing, error: existingError } = await supabase
    .from('application_document_chunks')
    .select('application_document_id')
    .eq('application_id', applicationId);
  if (existingError) {
    throw new Error(`Failed to read existing chunks for ${applicationId}: ${existingError.message}`);
  }
  const alreadyIndexed = new Set((existing ?? []).map((row) => row.application_document_id as string));

  const result: IngestResult = { documentsIndexed: 0, documentsSkipped: 0, chunksWritten: 0 };

  for (const doc of documents ?? []) {
    if (doc.mime_type !== 'application/pdf' || alreadyIndexed.has(doc.id)) {
      result.documentsSkipped += 1;
      continue;
    }

    const { data: fileData, error: downloadError } = await supabase.storage.from(UPLOADS_BUCKET).download(doc.storage_path);
    if (downloadError || !fileData) {
      throw new Error(`Failed to download ${doc.storage_path}: ${downloadError?.message ?? 'no data'}`);
    }
    const density = await computeTextDensity(Buffer.from(await fileData.arrayBuffer()));
    if (density.route !== 'text' || !density.extractedText) {
      result.documentsSkipped += 1;
      continue;
    }

    const chunks = chunkText(density.extractedText).slice(0, MAX_CHUNKS_PER_DOCUMENT);
    if (chunks.length === 0) {
      result.documentsSkipped += 1;
      continue;
    }

    const rows = [];
    for (const [chunkIndex, content] of chunks.entries()) {
      rows.push({
        org_id: application.org_id,
        application_id: applicationId,
        application_document_id: doc.id,
        chunk_index: chunkIndex,
        content,
        embedding: null,
      });
    }

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      // upsert-ignore keeps a retried run from failing on the unique
      // (application_document_id, chunk_index) key after a partial insert.
      const { error: insertError } = await supabase
        .from('application_document_chunks')
        .upsert(rows.slice(i, i + INSERT_BATCH_SIZE), { onConflict: 'application_document_id,chunk_index', ignoreDuplicates: true });
      if (insertError) {
        throw new Error(`Failed to insert chunks for document ${doc.id}: ${insertError.message}`);
      }
    }
    result.documentsIndexed += 1;
    result.chunksWritten += rows.length;
  }

  return result;
}
