// Gate 6.2: which authority a project answers to (master prompt §6). An
// address or postal code is a clue, not proof, so the only adapter in this
// gate is manual confirmation (decision D5): the user's typed location narrows
// the candidates by exact match, and the user confirms one. Nothing here calls
// a geocoder, and nothing ever substitutes a "nearby" or similarly named
// municipality -- no exact match is "unsupported_scope", not a guess.

export interface JurisdictionCandidate {
  id: string;
  country: string;
  provinceCode: string;
  municipality: string;
  coverageLevel: 'verified' | 'assisted' | 'listed';
}

export interface AuthorityCandidate {
  id: string;
  name: string;
  jurisdictionId: string | null;
  provinceCode: string;
}

export type AuthorityResolution =
  | { status: 'confirmed'; jurisdiction: JurisdictionCandidate; authorityIds: string[] }
  | { status: 'multiple_authorities'; jurisdiction: JurisdictionCandidate; authorityIds: string[] }
  | { status: 'needs_location_confirmation'; candidates: JurisdictionCandidate[]; missing: ('province' | 'municipality' | 'confirmation')[] }
  | { status: 'unsupported_scope'; reason: string }
  | { status: 'needs_authority_review'; jurisdiction: JurisdictionCandidate; reason: string };

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-CA');

export function resolveAuthorityManually(input: {
  provinceCode?: string | null;
  municipality?: string | null;
  // Set only after the user explicitly picked a jurisdiction.
  confirmedJurisdictionId?: string | null;
  jurisdictions: readonly JurisdictionCandidate[];
  authorities: readonly AuthorityCandidate[];
}): AuthorityResolution {
  const province = input.provinceCode?.trim().toUpperCase() || null;
  const municipality = input.municipality ? normalize(input.municipality) : null;

  if (input.confirmedJurisdictionId) {
    const jurisdiction = input.jurisdictions.find((j) => j.id === input.confirmedJurisdictionId);
    if (!jurisdiction) return { status: 'unsupported_scope', reason: 'The confirmed jurisdiction is not in the supported list.' };
    // A confirmation that contradicts the typed location is not silently accepted.
    if ((province && jurisdiction.provinceCode !== province) || (municipality && normalize(jurisdiction.municipality) !== municipality)) {
      return { status: 'needs_location_confirmation', candidates: [jurisdiction], missing: ['confirmation'] };
    }
    const authorityIds = input.authorities
      .filter((a) => a.jurisdictionId === jurisdiction.id)
      .map((a) => a.id)
      .sort();
    if (authorityIds.length === 0) {
      return { status: 'needs_authority_review', jurisdiction, reason: 'No issuing authority is recorded for this jurisdiction.' };
    }
    return authorityIds.length === 1
      ? { status: 'confirmed', jurisdiction, authorityIds }
      : { status: 'multiple_authorities', jurisdiction, authorityIds };
  }

  const missing: ('province' | 'municipality')[] = [];
  if (!province) missing.push('province');
  if (!municipality) missing.push('municipality');
  if (missing.length > 0) {
    const candidates = province ? input.jurisdictions.filter((j) => j.provinceCode === province) : [];
    return { status: 'needs_location_confirmation', candidates, missing };
  }

  const candidates = input.jurisdictions.filter(
    (j) => j.provinceCode === province && normalize(j.municipality) === municipality
  );
  if (candidates.length === 0) {
    return { status: 'unsupported_scope', reason: `PermitField does not cover ${input.municipality?.trim()}, ${province} yet.` };
  }
  // Even a single exact match needs the user's confirmation.
  return { status: 'needs_location_confirmation', candidates, missing: ['confirmation'] };
}
