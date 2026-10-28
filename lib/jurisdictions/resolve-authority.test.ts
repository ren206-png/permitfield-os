import { describe, expect, it } from 'vitest';
import { resolveAuthorityManually, type AuthorityCandidate, type JurisdictionCandidate } from './resolve-authority';

const jurisdictions: JurisdictionCandidate[] = [
  { id: 'van', country: 'CA', provinceCode: 'BC', municipality: 'Vancouver', coverageLevel: 'assisted' },
  { id: 'nvan', country: 'CA', provinceCode: 'BC', municipality: 'North Vancouver', coverageLevel: 'listed' },
  { id: 'tor', country: 'CA', provinceCode: 'ON', municipality: 'Toronto', coverageLevel: 'verified' },
  { id: 'cgy', country: 'CA', provinceCode: 'AB', municipality: 'Calgary', coverageLevel: 'verified' },
];
const authorities: AuthorityCandidate[] = [
  { id: 'van-city', name: 'City of Vancouver', jurisdictionId: 'van', provinceCode: 'BC' },
  { id: 'tor-city', name: 'City of Toronto', jurisdictionId: 'tor', provinceCode: 'ON' },
  { id: 'tor-esa', name: 'Electrical Safety Authority', jurisdictionId: 'tor', provinceCode: 'ON' },
];
const base = { jurisdictions, authorities };

describe('resolveAuthorityManually (D5: manual confirmation only)', () => {
  it('asks for what is missing', () => {
    expect(resolveAuthorityManually({ ...base })).toMatchObject({ status: 'needs_location_confirmation', missing: ['province', 'municipality'] });
    const provinceOnly = resolveAuthorityManually({ ...base, provinceCode: 'bc' });
    expect(provinceOnly).toMatchObject({ status: 'needs_location_confirmation', missing: ['municipality'] });
    expect(provinceOnly.status === 'needs_location_confirmation' && provinceOnly.candidates.map((c) => c.id)).toEqual(['van', 'nvan']);
  });

  it('an exact match still needs the user to confirm it', () => {
    const result = resolveAuthorityManually({ ...base, provinceCode: 'BC', municipality: '  vancouver ' });
    expect(result).toMatchObject({ status: 'needs_location_confirmation', missing: ['confirmation'] });
    expect(result.status === 'needs_location_confirmation' && result.candidates.map((c) => c.id)).toEqual(['van']);
  });

  it('never substitutes a nearby or similarly named city', () => {
    expect(resolveAuthorityManually({ ...base, provinceCode: 'BC', municipality: 'Burnaby' })).toMatchObject({ status: 'unsupported_scope' });
    expect(resolveAuthorityManually({ ...base, provinceCode: 'BC', municipality: 'Vancouve' })).toMatchObject({ status: 'unsupported_scope' });
    expect(resolveAuthorityManually({ ...base, provinceCode: 'ON', municipality: 'Vancouver' })).toMatchObject({ status: 'unsupported_scope' });
  });

  it('a confirmed city with one authority is confirmed; with several, every authority is surfaced', () => {
    expect(resolveAuthorityManually({ ...base, confirmedJurisdictionId: 'van' })).toMatchObject({ status: 'confirmed', authorityIds: ['van-city'] });
    expect(resolveAuthorityManually({ ...base, confirmedJurisdictionId: 'tor' })).toMatchObject({
      status: 'multiple_authorities',
      authorityIds: ['tor-city', 'tor-esa'],
    });
  });

  it('a confirmed city with no recorded authority goes to review', () => {
    expect(resolveAuthorityManually({ ...base, confirmedJurisdictionId: 'cgy' })).toMatchObject({ status: 'needs_authority_review' });
  });

  it('a confirmation that contradicts the typed location is not accepted silently', () => {
    expect(resolveAuthorityManually({ ...base, provinceCode: 'ON', municipality: 'Toronto', confirmedJurisdictionId: 'van' })).toMatchObject({
      status: 'needs_location_confirmation',
      missing: ['confirmation'],
    });
    expect(resolveAuthorityManually({ ...base, confirmedJurisdictionId: 'nowhere' })).toMatchObject({ status: 'unsupported_scope' });
  });
});
