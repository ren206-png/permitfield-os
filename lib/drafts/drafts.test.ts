import { describe, expect, it } from 'vitest';
import { assembleCorrectionResponse, candidateDocuments, NO_EVIDENCE_MARK } from './correction';
import { decideAiWrite, decideHumanSave, latestVersion, type DraftVersionRow } from './versions';

// Gate 6.5 exit evidence (master prompt §17 N.5): "human-edit preservation
// + concurrency tests". The database side (two saves of the same version
// collide) is in supabase/tests/copilot_drafts_fees.test.sql.

const v = (version: number, origin: DraftVersionRow['origin']): DraftVersionRow => ({
  thread_id: 't',
  version,
  origin,
  body: `v${version}`,
  created_at: `2026-10-${10 + version}T00:00:00Z`,
});

describe('human-edit preservation', () => {
  it('AI writes the first version, and may follow an AI version', () => {
    expect(decideAiWrite(null)).toEqual({ write: true, version: 1, basedOn: null });
    expect(decideAiWrite(v(2, 'ai_generated'))).toEqual({ write: true, version: 3, basedOn: 2 });
  });

  it('AI never writes over a human edit: it can only suggest', () => {
    expect(decideAiWrite(v(3, 'human_edited'))).toEqual({ write: false, reason: 'human_edits_present' });
    expect(decideAiWrite(latestVersion([v(1, 'ai_generated'), v(3, 'human_edited'), v(2, 'ai_generated')]))).toEqual({
      write: false,
      reason: 'human_edits_present',
    });
  });
});

describe('optimistic concurrency', () => {
  it('a save on the version being viewed becomes the next version', () => {
    expect(decideHumanSave(null, null)).toEqual({ ok: true, version: 1, basedOn: null });
    expect(decideHumanSave(v(4, 'ai_generated'), 4)).toEqual({ ok: true, version: 5, basedOn: 4 });
  });

  it('a save on an older version is refused as stale (someone saved in between)', () => {
    expect(decideHumanSave(v(5, 'human_edited'), 4)).toEqual({ ok: false, reason: 'stale_base' });
    expect(decideHumanSave(v(1, 'ai_generated'), null)).toEqual({ ok: false, reason: 'stale_base' });
  });
});

describe('assembleCorrectionResponse', () => {
  const docs = [
    { id: 'd1', filename: 'A-101 rev B.pdf', kind: 'blueprint', uploadedAt: '2026-11-05T10:00:00Z' },
    { id: 'd0', filename: 'A-101.pdf', kind: 'blueprint', uploadedAt: '2026-10-01T10:00:00Z' },
  ];

  it('only documents uploaded since the request can support a response', () => {
    expect(candidateDocuments(docs, '2026-11-03').map((d) => d.id)).toEqual(['d1']);
  });

  it('marks every item without a real supporting document, whatever the wording claims', () => {
    const result = assembleCorrectionResponse({
      reference: 'BP-2026-0042',
      receivedOn: '2026-11-03',
      items: ['Show the exit sign locations.', 'Provide the fire separation rating for the demising wall.', 'Add the stair detail.'],
      responses: [
        { item_number: 1, response: 'Exit signs are now shown on A-101.', evidence_document_ids: ['d1'] },
        { item_number: 2, response: 'The wall has been upgraded to a 1-hour rating.', evidence_document_ids: [] },
        { item_number: 3, response: 'Detail added.', evidence_document_ids: ['d0', 'not-a-doc'] },
      ],
      documents: candidateDocuments(docs, '2026-11-03'),
      opening: 'Please find our responses below.',
      closing: '[Name, title -- unsigned draft]',
    });
    expect(result.itemsWithoutEvidence).toEqual([2, 3]);
    expect(result.discardedEvidenceIds.sort()).toEqual(['d0', 'not-a-doc']);
    expect(result.body).toContain('Supporting documents: A-101 rev B.pdf');
    expect(result.body.split(NO_EVIDENCE_MARK)).toHaveLength(3);
    expect(result.body.startsWith('Re: correction request BP-2026-0042 received 2026-11-03')).toBe(true);
  });

  it('an item the model skipped is shown as not drafted, never dropped', () => {
    const result = assembleCorrectionResponse({
      reference: null,
      receivedOn: '2026-11-03',
      items: ['One', 'Two'],
      responses: [{ item_number: 1, response: 'Done in rev B.', evidence_document_ids: [] }],
      documents: [],
      opening: '',
      closing: '',
    });
    expect(result.body).toContain('2. Two\nResponse: [No response drafted for this item.]');
  });
});
