import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIELD_RESOLVER_KEYS,
  parseCivicAddress,
  parsePostalCode,
  resolveFieldForFilling,
  resolveFieldValue,
  type FieldResolutionContext,
} from './resolve-fields';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../supabase/migrations');

describe('maps_to coverage', () => {
  it('has a resolver for every maps_to key the migrations use', () => {
    const used = new Set<string>();
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      for (const match of sql.matchAll(/'((?:applicant|application|contractor)\.[A-Za-z]+)'/g)) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((key) => !FIELD_RESOLVER_KEYS.includes(key));
    expect(missing, `maps_to keys with no resolver: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('parseCivicAddress()', () => {
  it.each([
    ['123 Test St, Toronto, ON', { civicNumber: '123', street: 'Test St', city: 'Toronto', unit: null }],
    ['6911 No. 3 Road, Richmond, BC V6Y 2C1', { civicNumber: '6911', street: 'No. 3 Road', city: 'Richmond', unit: null }],
    ['12A King St W, Toronto, ON M5H 1A1', { civicNumber: '12A', street: 'King St W', city: 'Toronto', unit: null }],
    ['5-100 Queen St, Ottawa, ON', { civicNumber: '100', street: 'Queen St', city: 'Ottawa', unit: '5' }],
    ['400 Sheldon Dr, Unit 1, Cambridge, ON', { civicNumber: '400', street: 'Sheldon Dr', city: 'Cambridge', unit: '1' }],
    ['100 Main Street, Surrey', { civicNumber: '100', street: 'Main Street', city: 'Surrey', unit: null }],
    ['Unit 210, 100 King St W, Toronto, ON M5X 1A9', { civicNumber: '100', street: 'King St W', city: 'Toronto', unit: '210' }],
    ['Suite 4B, 55 Bay St, Toronto, ON', { civicNumber: '55', street: 'Bay St', city: 'Toronto', unit: '4B' }],
    ['#7, 10355 152 St, Surrey, BC', { civicNumber: '10355', street: '152 St', city: 'Surrey', unit: '7' }],
  ])('splits %s', (address, expected) => {
    expect(parseCivicAddress(address)).toEqual(expected);
  });

  it('leaves parts blank rather than guessing', () => {
    expect(parseCivicAddress(null)).toEqual({ civicNumber: null, street: null, city: null, unit: null });
    expect(parseCivicAddress('Lot 7, Rural Route 2')).toEqual({ civicNumber: null, street: null, city: null, unit: null });
    expect(parseCivicAddress('123 Main St, Unit 4, ON').city).toBeNull();
  });
});

describe('applicant first/last name', () => {
  const ctx = (applicantName: string, companyName: string | null = null) =>
    ({
      extraction: { applicant_name: { value: applicantName, confidence: 0.95, source_document_id: null, source_page: null } },
      estimatedJobValueCents: null,
      application: { projectTitle: null, projectAddress: null },
      orgContactEmail: null,
      contractor: companyName ? { companyName, primaryLicenseNumber: null, licenseProvinceCode: null } : null,
    }) as unknown as FieldResolutionContext;

  it('splits a person\'s name', () => {
    expect(resolveFieldValue('applicant.firstName', ctx('Jordan Rivera')).value).toBe('Jordan');
    expect(resolveFieldValue('applicant.lastName', ctx('Jordan Rivera')).value).toBe('Rivera');
  });

  it('leaves both blank for a company name, so "Inc" never becomes a last name', () => {
    for (const company of ['Renco Technologies Inc', 'Acme Electric Ltd.', 'Northside Contracting', 'BuildCo Corp']) {
      expect(resolveFieldValue('applicant.firstName', ctx(company)).value, company).toBeNull();
      expect(resolveFieldValue('applicant.lastName', ctx(company)).value, company).toBeNull();
    }
    expect(resolveFieldValue('applicant.lastName', ctx('Renco Technologies', 'Renco Technologies')).value).toBeNull();
    expect(resolveFieldValue('applicant.fullName', ctx('Renco Technologies Inc')).value).toBe('Renco Technologies Inc');
  });
});

describe('resolvers added for the BC and ESA field maps', () => {
  const extraction = {
    applicant_name: { value: 'Jordan Rivera', confidence: 0.95, source_document_id: null, source_page: null },
    scope_of_work_summary: { value: 'Replace 100A panel with 200A', confidence: 0.9, source_document_id: null, source_page: null },
  };
  const ctx = {
    extraction,
    estimatedJobValueCents: null,
    application: { projectTitle: 'Panel upgrade', projectAddress: '123 Test St, Toronto, ON' },
    orgContactEmail: 'office@acme.example',
    contractor: null,
  } as unknown as FieldResolutionContext;

  it("fills the contractor's own job value with full confidence, with or without an extraction", () => {
    expect(resolveFieldValue('application.estimatedJobValueDollars', { ...ctx, estimatedJobValueCents: 4800000 })).toEqual({
      value: '48,000.00',
      confidence: 1,
    });
    expect(resolveFieldValue('application.estimatedJobValueDollars', { ...ctx, extraction: null, estimatedJobValueCents: 4800000 }).confidence).toBe(1);
    expect(resolveFieldValue('application.estimatedJobValueDollars', ctx).value).toBeNull();
  });

  it('resolves the unit from a leading unit segment', () => {
    const withUnit = { ...ctx, application: { ...ctx.application, projectAddress: 'Unit 210, 100 King St W, Toronto, ON M5X 1A9' } };
    expect(resolveFieldValue('application.addressUnit', withUnit).value).toBe('210');
    expect(resolveFieldValue('application.addressStreetLine', withUnit).value).toBe('100 King St W');
    expect(resolveFieldValue('application.addressUnit', ctx).value).toBeNull();
  });

  it('resolves applicant name/email and the project address and description', () => {
    expect(resolveFieldValue('applicant.fullName', ctx).value).toBe('Jordan Rivera');
    expect(resolveFieldValue('applicant.email', ctx)).toEqual({ value: 'office@acme.example', confidence: 1 });
    expect(resolveFieldValue('application.projectAddress', ctx).value).toBe('123 Test St, Toronto, ON');
    expect(resolveFieldValue('application.projectDescription', ctx).value).toBe('Replace 100A panel with 200A');
    expect(resolveFieldValue('application.addressCivicNumber', ctx).value).toBe('123');
    expect(resolveFieldValue('application.addressStreet', ctx).value).toBe('Test St');
    expect(resolveFieldValue('application.addressCity', ctx).value).toBe('Toronto');
  });

  it('still applies the confidence gate to AI-extracted values', () => {
    const lowConfidence = {
      ...ctx,
      extraction: { applicant_name: { ...extraction.applicant_name, confidence: 0.4 } },
    } as unknown as FieldResolutionContext;
    expect(resolveFieldForFilling('applicant.fullName', lowConfidence)).toEqual({ value: null, belowConfidenceThreshold: true });
  });

  it('leaves email blank when the org has no contact email', () => {
    expect(resolveFieldValue('applicant.email', { ...ctx, orgContactEmail: null }).value).toBeNull();
  });
});

describe('parsePostalCode()', () => {
  it('finds and normalizes a Canadian postal code', () => {
    expect(parsePostalCode('110 Laurier Ave W, Ottawa, ON k1p1j1')).toBe('K1P 1J1');
    expect(parsePostalCode('6911 No. 3 Road, Richmond, BC V6Y 2C1')).toBe('V6Y 2C1');
    expect(parsePostalCode('100 Main St, Toronto, ON')).toBeNull();
    expect(parsePostalCode(null)).toBeNull();
  });
});

describe('Ontario provincial form resolvers', () => {
  const ctx = {
    extraction: null,
    estimatedJobValueCents: null,
    application: { projectTitle: null, projectAddress: '110 Laurier Ave W, Ottawa, ON K1P 1J1' },
    orgContactEmail: null,
    contractor: null,
  } as unknown as FieldResolutionContext;

  it('fills the street line and postal code from the project address', () => {
    expect(resolveFieldValue('application.addressStreetLine', ctx).value).toBe('110 Laurier Ave W');
    expect(resolveFieldValue('application.addressPostalCode', ctx).value).toBe('K1P 1J1');
    expect(resolveFieldValue('application.addressCity', ctx).value).toBe('Ottawa');
  });
});

describe('form.clear', () => {
  it('overwrites a pre-filled template field with an empty value (not "leave as is")', () => {
    expect(resolveFieldValue('form.clear', {} as FieldResolutionContext)).toEqual({ value: '', confidence: 1 });
  });
});
