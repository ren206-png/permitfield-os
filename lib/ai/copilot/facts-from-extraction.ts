import { PermitExtractionSchema } from '@/lib/ai/schemas/extraction';
import type { FactKey } from '@/lib/requirements/rules/fact-keys';

// Gate 6.4 (master prompt §13): turns the document extraction the app
// already runs (lib/ai/extract-permit-data.ts, 6 fields) into PROPOSED
// project facts for a person to confirm. Nothing here is a confirmed fact:
// the rule engine ignores proposals (lib/requirements/rules/facts.ts).
//
// Only fields with a structured meaning become facts (floor area, service
// size). Names, licence numbers, the job value and the scope summary are not
// facts any rule condition reads. A null field (absent or unreadable in the
// documents) produces no proposal -- it is never guessed.

export interface FactProposal {
  factKey: FactKey;
  value: number;
  unit: string;
  sourceDocumentId: string | null;
  sourceLocator: string | null;
  confidence: number;
}

const MAPPING: { field: 'square_footage' | 'electrical_amps'; factKey: FactKey; unit: string }[] = [
  // square_footage is square metres (see the extraction schema's own note).
  { field: 'square_footage', factKey: 'project.floor_area', unit: 'm2' },
  { field: 'electrical_amps', factKey: 'electrical.service_amps', unit: 'A' },
];

export function proposalsFromExtraction(parsedData: unknown): FactProposal[] {
  const parsed = PermitExtractionSchema.safeParse(parsedData);
  if (!parsed.success) return [];
  const proposals: FactProposal[] = [];
  for (const { field, factKey, unit } of MAPPING) {
    const extracted = parsed.data[field];
    if (extracted.value === null) continue;
    proposals.push({
      factKey,
      value: extracted.value,
      unit,
      sourceDocumentId: extracted.source_document_id,
      // project_facts requires a document whenever a locator is given.
      sourceLocator: extracted.source_document_id && extracted.source_page ? `p. ${extracted.source_page}` : null,
      confidence: extracted.confidence,
    });
  }
  return proposals;
}
