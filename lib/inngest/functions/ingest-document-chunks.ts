import { inngest, type PermitEventPayloads } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service-client';
import { isOrgDocumentRetrievalEnabled } from '@/lib/flags';
import { ingestApplicationDocumentChunks } from '@/lib/ai/ingest-org-document-chunks';

// permit.ingest-document-chunks: indexes an application's uploaded PDFs into
// application_document_chunks so they can be searched
// (lib/ai/retrieve-org-document-chunks.ts). A second, independent subscriber
// to 'permit/application.documents_ready', alongside permit-extract and
// permit-classify-documents; it never touches the application's status and a
// failure here cannot hold up extraction. Off unless
// PERMITFIELD_FF_ORG_DOCUMENT_RETRIEVAL is on.
export const permitIngestDocumentChunks = inngest.createFunction(
  {
    id: 'permit-ingest-document-chunks',
    name: 'Index application documents for search',
    triggers: [{ event: 'permit/application.documents_ready' }],
    idempotency: 'event.data.applicationId + "-" + event.data.documentsFingerprint',
    concurrency: { limit: 1, key: 'event.data.applicationId' },
    retries: 2,
  },
  async ({ event, step }) => {
    if (!isOrgDocumentRetrievalEnabled()) {
      return { skipped: 'flag_off' as const };
    }
    const { applicationId } = event.data as PermitEventPayloads['permit/application.documents_ready'];
    return step.run('ingest-chunks', async () => ingestApplicationDocumentChunks(createServiceClient(), applicationId));
  }
);
