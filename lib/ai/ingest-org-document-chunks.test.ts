import { beforeEach, describe, expect, it, vi } from 'vitest';

const { computeTextDensity } = vi.hoisted(() => ({ computeTextDensity: vi.fn() }));
vi.mock('@/lib/pdf/text-density', () => ({ computeTextDensity }));

import { ingestApplicationDocumentChunks } from './ingest-org-document-chunks';

function fakeSupabase(opts: { docs: unknown[]; existing?: unknown[] }) {
  const upserts: Array<Array<Record<string, unknown>>> = [];
  const result = (data: unknown) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.single = async () => ({ data, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
    return chain;
  };
  const client = {
    from: (table: string) => {
      if (table === 'permit_applications') return result({ id: 'app-1', org_id: 'org-from-db' });
      if (table === 'application_documents') return result(opts.docs);
      return {
        ...(result(opts.existing ?? []) as object),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          upserts.push(rows);
          return { error: null };
        },
      };
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob(['pdf']), error: null }) }) },
  };
  return { client: client as never, upserts };
}

beforeEach(() => {
  computeTextDensity.mockReset();
  delete process.env.PERMITFIELD_FF_VECTOR_RETRIEVAL;
});

describe('ingestApplicationDocumentChunks()', () => {
  it('stores chunks under the application’s own org_id, with no embedding when vectors are off', async () => {
    computeTextDensity.mockResolvedValue({ route: 'text', extractedText: 'Scope of work.\n\nElectrical panel upgrade.' });
    const { client, upserts } = fakeSupabase({ docs: [{ id: 'doc-1', storage_path: 'a.pdf', mime_type: 'application/pdf' }] });
    const result = await ingestApplicationDocumentChunks(client, 'app-1');
    expect(result).toEqual({ documentsIndexed: 1, documentsSkipped: 0, chunksWritten: 1 });
    expect(upserts[0][0]).toMatchObject({ org_id: 'org-from-db', application_id: 'app-1', application_document_id: 'doc-1', chunk_index: 0, embedding: null });
  });

  it('skips images, scans and documents that already have chunks', async () => {
    computeTextDensity.mockResolvedValue({ route: 'vision', extractedText: null });
    const { client, upserts } = fakeSupabase({
      docs: [
        { id: 'img', storage_path: 'a.png', mime_type: 'image/png' },
        { id: 'scan', storage_path: 'b.pdf', mime_type: 'application/pdf' },
        { id: 'done', storage_path: 'c.pdf', mime_type: 'application/pdf' },
      ],
      existing: [{ application_document_id: 'done' }],
    });
    const result = await ingestApplicationDocumentChunks(client, 'app-1');
    expect(result).toEqual({ documentsIndexed: 0, documentsSkipped: 3, chunksWritten: 0 });
    expect(upserts).toHaveLength(0);
  });
});
