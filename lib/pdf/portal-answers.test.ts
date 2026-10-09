import { describe, expect, it } from 'vitest';
import { portalAnswers, portalAnswersText } from './portal-answers';
import type { FieldResolutionContext } from './resolve-fields';

const field = (value: string | number | null, confidence: number) => ({ value, confidence, source_document_id: null, source_page: null });

const context = {
  extraction: {
    applicant_name: field('Jordan Rivera', 0.95),
    scope_of_work_summary: field('New partitions and lighting for a 92 m2 office', 0.9),
    square_footage: field(92, 0.4),
  },
  estimatedJobValueCents: 4800000,
  application: { projectTitle: 'Office fit-out', projectAddress: 'Unit 105, 1000 8 Ave SW, Calgary, AB T2P 1J5' },
  orgContactEmail: 'office@acme.example',
  contractor: { companyName: 'Acme Interiors Ltd', primaryLicenseNumber: null, licenseProvinceCode: 'AB' },
} as unknown as FieldResolutionContext;

describe('portalAnswers()', () => {
  const answers = portalAnswers(context);
  const byLabel = Object.fromEntries(answers.map((a) => [a.label, a]));

  it('answers each portal question from the application, contractor and documents', () => {
    expect(byLabel['Building number and street'].value).toBe('1000 8 Ave SW');
    expect(byLabel['Unit'].value).toBe('105');
    expect(byLabel['City'].value).toBe('Calgary');
    expect(byLabel['Postal code'].value).toBe('T2P 1J5');
    expect(byLabel['Estimated project cost ($)'].value).toBe('48,000.00');
    expect(byLabel['Description of work'].value).toBe('New partitions and lighting for a 92 m2 office');
    expect(byLabel['Contractor company'].value).toBe('Acme Interiors Ltd');
    expect(byLabel['Applicant email'].value).toBe('office@acme.example');
  });

  it('shows a low-confidence document value but flags it, and leaves missing ones blank', () => {
    expect(byLabel['Area of work (m²)']).toEqual({ label: 'Area of work (m²)', value: '92', needsCheck: true });
    expect(byLabel['Applicant name'].needsCheck).toBe(false);
    expect(byLabel['Contractor licence number']).toEqual({ label: 'Contractor licence number', value: null, needsCheck: false });
  });

  it('copies every filled answer as label: value lines', () => {
    const text = portalAnswersText(answers);
    expect(text).toContain('Building number and street: 1000 8 Ave SW');
    expect(text).toContain('Estimated project cost ($): 48,000.00');
    expect(text).not.toContain('Contractor licence number');
  });
});
