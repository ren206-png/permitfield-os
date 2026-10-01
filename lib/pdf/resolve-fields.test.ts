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
    ['123 Test St, Toronto, ON', { civicNumber: '123', street: 'Test St', city: 'Toronto' }],
    ['6911 No. 3 Road, Richmond, BC V6Y 2C1', { civicNumber: '6911', street: 'No. 3 Road', city: 'Richmond' }],
    ['12A King St W, Toronto, ON M5H 1A1', { civicNumber: '12A', street: 'King St W', city: 'Toronto' }],
    ['5-100 Queen St, Ottawa, ON', { civicNumber: '100', street: 'Queen St', city: 'Ottawa' }],
    ['400 Sheldon Dr, Unit 1, Cambridge, ON', { civicNumber: '400', street: 'Sheldon Dr', city: 'Cambridge' }],
    ['100 Main Street, Surrey', { civicNumber: '100', street: 'Main Street', city: 'Surrey' }],
  ])('splits %s', (address, expected) => {
    expect(parseCivicAddress(address)).toEqual(expected);
  });

  it('leaves parts blank rather than guessing', () => {
    expect(parseCivicAddress(null)).toEqual({ civicNumber: null, street: null, city: null });
    expect(parseCivicAddress('Lot 7, Rural Route 2')).toEqual({ civicNumber: null, street: null, city: null });
    expect(parseCivicAddress('123 Main St, Unit 4, ON').city).toBeNull();
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
