import { z } from 'zod';
import type { EvidenceBundle, EvidenceItem } from './evidence';

// Gate 6.3: citation validation (master prompt §11: "every citation maps to
// a real retrieved source revision and locator, validated against the
// evidence bundle (Zod) before rendering"). A model's citations are parsed
// at the trust boundary; each must name an evidence id that is in the
// bundle the model was given, and its quote must actually appear in that
// evidence. Anything else is rejected with a reason -- never repaired,
// never rendered.

export const MAX_CITATIONS = 20;
export const MAX_QUOTE_CHARS = 500;
export const MIN_QUOTE_CHARS = 8;

export const CitationSchema = z.strictObject({
  evidence_id: z.string().regex(/^[SD][1-9][0-9]?$/),
  quote: z.string().trim().min(MIN_QUOTE_CHARS).max(MAX_QUOTE_CHARS),
});

export const CitationListSchema = z.array(z.unknown()).max(MAX_CITATIONS);

export type RejectedCitationReason = 'not_a_list' | 'too_many' | 'invalid_shape' | 'unknown_evidence' | 'quote_not_in_evidence';

export interface ValidCitation {
  evidenceId: string;
  quote: string;
  evidence: EvidenceItem;
}

export interface CitationValidation {
  valid: ValidCitation[];
  rejected: { index: number | null; reason: RejectedCitationReason }[];
}

// Whitespace and typographic quote/dash differences are not a fabrication;
// anything else is.
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function validateCitations(bundle: EvidenceBundle, raw: unknown): CitationValidation {
  if (!Array.isArray(raw)) return { valid: [], rejected: [{ index: null, reason: 'not_a_list' }] };
  if (!CitationListSchema.safeParse(raw).success) return { valid: [], rejected: [{ index: null, reason: 'too_many' }] };

  const byId = new Map(bundle.items.map((item) => [item.evidenceId, item]));
  const result: CitationValidation = { valid: [], rejected: [] };

  raw.forEach((entry, index) => {
    const parsed = CitationSchema.safeParse(entry);
    if (!parsed.success) {
      result.rejected.push({ index, reason: 'invalid_shape' });
      return;
    }
    const evidence = byId.get(parsed.data.evidence_id);
    if (!evidence) {
      result.rejected.push({ index, reason: 'unknown_evidence' });
      return;
    }
    if (!normalizeForMatch(evidence.content).includes(normalizeForMatch(parsed.data.quote))) {
      result.rejected.push({ index, reason: 'quote_not_in_evidence' });
      return;
    }
    result.valid.push({ evidenceId: parsed.data.evidence_id, quote: parsed.data.quote, evidence });
  });
  return result;
}
