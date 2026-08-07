import { describe, it, expect } from 'vitest';
import {
  provinceCodeSchema,
  postalCodeSchema,
  ClientInputSchema,
  PropertyInputSchema,
  CreateProjectFormSchema,
  CANADIAN_PROVINCE_CODES,
} from './schemas';

// Lifecycle & Compliance Expansion, Phase 1.1. Pure schema tests, no DB/
// Next.js dependency, same discipline as lib/authz/index.test.ts (this
// repo's other framework-free vitest target).

describe('provinceCodeSchema', () => {
  it('accepts every real Canadian province/territory code', () => {
    for (const code of CANADIAN_PROVINCE_CODES) {
      expect(provinceCodeSchema.parse(code)).toBe(code);
    }
  });

  it('uppercases a lowercase code', () => {
    expect(provinceCodeSchema.parse('on')).toBe('ON');
  });

  it('trims surrounding whitespace', () => {
    expect(provinceCodeSchema.parse('  ON  ')).toBe('ON');
  });

  it('rejects a non-Canadian or malformed code', () => {
    expect(() => provinceCodeSchema.parse('XX')).toThrow();
    expect(() => provinceCodeSchema.parse('CA')).toThrow();
    expect(() => provinceCodeSchema.parse('Ontario')).toThrow();
  });
});

describe('postalCodeSchema', () => {
  it('accepts a properly spaced postal code unchanged', () => {
    expect(postalCodeSchema.parse('M5V 2T6')).toBe('M5V 2T6');
  });

  it('normalizes a lowercase, unspaced postal code to "A1A 1A1" uppercase form', () => {
    expect(postalCodeSchema.parse('m5v2t6')).toBe('M5V 2T6');
  });

  it('normalizes a dash-separated postal code', () => {
    expect(postalCodeSchema.parse('m5v-2t6')).toBe('M5V 2T6');
  });

  it('rejects a malformed postal code', () => {
    expect(() => postalCodeSchema.parse('12345')).toThrow();
    expect(() => postalCodeSchema.parse('M5V 2T')).toThrow();
    expect(() => postalCodeSchema.parse('not-a-postal-code')).toThrow();
  });
});

describe('ClientInputSchema', () => {
  it('requires a non-empty name', () => {
    expect(() => ClientInputSchema.parse({ name: '' })).toThrow();
  });

  it('accepts a name-only client, leaving email/phone/notes undefined', () => {
    const result = ClientInputSchema.parse({ name: 'Jane Doe' });
    expect(result).toEqual({ name: 'Jane Doe', email: undefined, phone: undefined, notes: undefined });
  });

  it('rejects an invalid email but accepts empty string as "not provided"', () => {
    expect(() => ClientInputSchema.parse({ name: 'Jane Doe', email: 'not-an-email' })).toThrow();
    expect(ClientInputSchema.parse({ name: 'Jane Doe', email: '' }).email).toBeUndefined();
    expect(ClientInputSchema.parse({ name: 'Jane Doe', email: 'jane@example.com' }).email).toBe(
      'jane@example.com'
    );
  });
});

describe('PropertyInputSchema', () => {
  const validProperty = {
    addressLine1: '123 Test St',
    city: 'Toronto',
    provinceCode: 'ON',
    postalCode: 'M5V 2T6',
  };

  it('accepts a minimal valid property with no client', () => {
    const result = PropertyInputSchema.parse(validProperty);
    expect(result.clientId).toBeUndefined();
    expect(result.provinceCode).toBe('ON');
    expect(result.postalCode).toBe('M5V 2T6');
  });

  it('requires addressLine1, city, provinceCode, and postalCode', () => {
    expect(() => PropertyInputSchema.parse({ ...validProperty, addressLine1: '' })).toThrow();
    expect(() => PropertyInputSchema.parse({ ...validProperty, city: '' })).toThrow();
    expect(() => PropertyInputSchema.parse({ ...validProperty, provinceCode: 'XX' })).toThrow();
    expect(() => PropertyInputSchema.parse({ ...validProperty, postalCode: 'bad' })).toThrow();
  });

  it('rejects a malformed clientId but accepts a well-formed uuid', () => {
    expect(() => PropertyInputSchema.parse({ ...validProperty, clientId: 'not-a-uuid' })).toThrow();
    expect(
      PropertyInputSchema.parse({ ...validProperty, clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
        .clientId
    ).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
  });
});

describe('CreateProjectFormSchema', () => {
  const minimal = { title: 'New service upgrade' };

  it('accepts a title-only submission (client/property/taxonomy all optional)', () => {
    const result = CreateProjectFormSchema.parse(minimal);
    expect(result.title).toBe('New service upgrade');
    expect(result.status).toBe('draft');
    expect(result.clientName).toBeUndefined();
    expect(result.addressLine1).toBeUndefined();
  });

  it('requires a non-empty title', () => {
    expect(() => CreateProjectFormSchema.parse({ title: '' })).toThrow();
  });

  it('accepts a fully-specified inline client and property', () => {
    const result = CreateProjectFormSchema.parse({
      ...minimal,
      clientName: 'Jane Doe',
      clientEmail: 'jane@example.com',
      addressLine1: '123 Test St',
      city: 'Toronto',
      provinceCode: 'on',
      postalCode: 'm5v2t6',
    });
    expect(result.clientName).toBe('Jane Doe');
    expect(result.provinceCode).toBe('ON');
    expect(result.postalCode).toBe('M5V 2T6');
  });

  it('rejects a partial property address (some but not all of the four required fields)', () => {
    expect(() =>
      CreateProjectFormSchema.parse({
        ...minimal,
        addressLine1: '123 Test St',
        // city/provinceCode/postalCode all missing
      })
    ).toThrow();

    expect(() =>
      CreateProjectFormSchema.parse({
        ...minimal,
        addressLine1: '123 Test St',
        city: 'Toronto',
        provinceCode: 'ON',
        // postalCode missing
      })
    ).toThrow();
  });

  it('accepts an explicit non-default status', () => {
    expect(CreateProjectFormSchema.parse({ ...minimal, status: 'active' }).status).toBe('active');
  });

  it('rejects an unrecognized status value', () => {
    expect(() => CreateProjectFormSchema.parse({ ...minimal, status: 'not-a-status' })).toThrow();
  });
});
