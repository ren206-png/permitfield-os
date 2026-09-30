import { describe, it, expect } from 'vitest';
import { fieldLabel, generatedDocumentLabel } from './document-labels';

describe('generatedDocumentLabel()', () => {
  const filing = '00000000-0000-0000-0004-000000000005';
  const names = new Map([[filing, 'City of Vancouver']]);

  it('names the form by its authority, and marks signed copies', () => {
    expect(generatedDocumentLabel(`${filing}-filled.pdf`, names)).toBe('City of Vancouver form');
    expect(generatedDocumentLabel(`${filing}-signed.pdf`, names)).toBe('City of Vancouver form (signed)');
    expect(generatedDocumentLabel(`${filing}-signed-upload.pdf`, names)).toBe('City of Vancouver form (signed copy, uploaded)');
  });

  it('falls back gracefully', () => {
    expect(generatedDocumentLabel('00000000-0000-0000-0004-000000000009-filled.pdf', names)).toBe('Filled form');
    expect(generatedDocumentLabel('something-else.pdf', names)).toBe('something-else.pdf');
  });
});

describe('fieldLabel()', () => {
  it('turns field keys into words', () => {
    expect(fieldLabel('applicant.email')).toBe('applicant email');
    expect(fieldLabel('application.someNewField')).toBe('some new field');
  });
});
