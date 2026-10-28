import { describe, expect, it } from 'vitest';
import { validateCitations } from './citations';
import type { EvidenceBundle } from './evidence';

const bundle: EvidenceBundle = {
  asOf: '2026-10-28',
  items: [
    {
      evidenceId: 'S1',
      kind: 'official_source',
      content: 'A building permit is required to construct an accessory building over 10 m² in area.',
      locator: 'Building permits › When you need one',
      sourceRevisionId: 'rev-1',
      sourceId: 'src-1',
      sourceType: 'forms_page',
      url: 'https://www.toronto.ca/permits',
      title: 'When you need a building permit',
      issuingBody: 'City of Toronto',
      revisionNumber: 2,
      publishedOn: null,
      effectiveFrom: null,
      effectiveTo: null,
      retrievedAt: '2026-10-20T00:00:00Z',
      accessScope: 'public',
      lastCheckedAt: '2026-10-27T00:00:00Z',
      freshness: 'fresh',
    },
    {
      evidenceId: 'D1',
      kind: 'contractor_document',
      content: 'Proposed shed: 9.5 m², rear yard.',
      locator: 'Uploaded document, part 1',
      applicationDocumentId: 'doc-1',
      chunkIndex: 0,
    },
  ],
};

describe('validateCitations', () => {
  it('accepts a citation whose quote is in the cited evidence, and resolves it to the source revision and locator', () => {
    const { valid, rejected } = validateCitations(bundle, [{ evidence_id: 'S1', quote: 'accessory building over 10 m² in area' }]);
    expect(rejected).toEqual([]);
    expect(valid).toHaveLength(1);
    expect(valid[0].evidence).toMatchObject({ kind: 'official_source', sourceRevisionId: 'rev-1', locator: 'Building permits › When you need one' });
  });

  it('tolerates whitespace, case and typographic quote/dash differences only', () => {
    const { valid } = validateCitations(bundle, [{ evidence_id: 'S1', quote: '  A BUILDING   permit is\nrequired ' }]);
    expect(valid).toHaveLength(1);
  });

  it('rejects a fabricated quote, an unknown evidence id, a quote from a different item, and bad shapes', () => {
    const { valid, rejected } = validateCitations(bundle, [
      { evidence_id: 'S1', quote: 'over 15 m² in area' },
      { evidence_id: 'S7', quote: 'A building permit is required' },
      { evidence_id: 'D1', quote: 'A building permit is required' },
      { evidence_id: 'S1', quote: 'A building permit is required', page: 4 },
      { evidence_id: 'S1', quote: 'short' },
      'S1',
    ]);
    expect(valid).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      'quote_not_in_evidence',
      'unknown_evidence',
      'quote_not_in_evidence',
      'invalid_shape',
      'invalid_shape',
      'invalid_shape',
    ]);
  });

  it('rejects a non-list and an oversized list outright', () => {
    expect(validateCitations(bundle, { evidence_id: 'S1' }).rejected).toEqual([{ index: null, reason: 'not_a_list' }]);
    const many = Array.from({ length: 21 }, () => ({ evidence_id: 'S1', quote: 'A building permit is required' }));
    expect(validateCitations(bundle, many)).toEqual({ valid: [], rejected: [{ index: null, reason: 'too_many' }] });
  });

  it('keeps contractor evidence labelled as contractor evidence', () => {
    const { valid } = validateCitations(bundle, [{ evidence_id: 'D1', quote: 'Proposed shed: 9.5 m²' }]);
    expect(valid[0].evidence.kind).toBe('contractor_document');
  });
});
