import { z } from 'zod';

// Gate 6.5: correction responses (master prompt §12 draft_correction_response
// "cannot claim work completed without evidence", §15 "correction cycles
// create versioned responses, not rewrites").
//
// The model writes a response per item and names the uploaded documents
// that support it; the SERVER assembles the letter. An item whose response
// cites no document -- or only ids that are not this application's
// documents uploaded after the request -- is marked in the text as needing
// a revised document, whatever the model's wording claims.

export const CorrectionItemsSchema = z.array(z.string().trim().min(1).max(2000)).min(1).max(100);

export interface CandidateDocument {
  id: string;
  filename: string;
  kind: string;
  uploadedAt: string;
}

export const ItemResponseSchema = z.strictObject({
  item_number: z.number().int().min(1),
  response: z.string().trim().min(1).max(4000),
  evidence_document_ids: z.array(z.string()).max(10),
});

export type ItemResponse = z.infer<typeof ItemResponseSchema>;

export interface AssembledResponse {
  body: string;
  itemsWithoutEvidence: number[];
  discardedEvidenceIds: string[];
}

export const NO_EVIDENCE_MARK = '[No revised document attached yet -- attach it before sending, or change this response.]';

export function assembleCorrectionResponse(input: {
  reference: string | null;
  receivedOn: string;
  items: string[];
  responses: ItemResponse[];
  documents: CandidateDocument[];
  opening: string;
  closing: string;
}): AssembledResponse {
  const docs = new Map(input.documents.map((d) => [d.id, d]));
  const byItem = new Map(input.responses.map((r) => [r.item_number, r]));
  const itemsWithoutEvidence: number[] = [];
  const discarded = new Set<string>();

  const sections = input.items.map((item, i) => {
    const n = i + 1;
    const r = byItem.get(n);
    const evidence = (r?.evidence_document_ids ?? []).filter((id) => {
      if (docs.has(id)) return true;
      discarded.add(id);
      return false;
    });
    if (evidence.length === 0) itemsWithoutEvidence.push(n);
    const lines = [`${n}. ${item}`, `Response: ${r ? r.response : '[No response drafted for this item.]'}`];
    lines.push(evidence.length > 0 ? `Supporting documents: ${evidence.map((id) => docs.get(id)!.filename).join(', ')}` : NO_EVIDENCE_MARK);
    return lines.join('\n');
  });

  const heading = `Re: correction request${input.reference ? ` ${input.reference}` : ''} received ${input.receivedOn}`;
  return {
    body: [heading, input.opening.trim(), ...sections, input.closing.trim()].filter(Boolean).join('\n\n'),
    itemsWithoutEvidence,
    discardedEvidenceIds: [...discarded],
  };
}

// Documents that can evidence a correction: this application's documents
// uploaded on or after the day the request was received.
export function candidateDocuments(documents: CandidateDocument[], receivedOn: string): CandidateDocument[] {
  return documents.filter((d) => d.uploadedAt.slice(0, 10) >= receivedOn);
}
