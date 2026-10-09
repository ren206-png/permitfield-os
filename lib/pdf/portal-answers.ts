import { PDF_FILL_MIN_CONFIDENCE } from './config';
import { resolveFieldValue, type FieldResolutionContext } from './resolve-fields';

// Answers for an authority's online application portal, for filings filed
// through a portal (Calgary has no PDF form at all; the others still ask for
// these details on screen before the upload). The same resolvers that fill
// the PDF forms (resolve-fields.ts), so the sheet and the forms agree.

export const PORTAL_ANSWER_FIELDS: { label: string; mapsTo: string }[] = [
  { label: 'Building number and street', mapsTo: 'application.addressStreetLine' },
  { label: 'Unit', mapsTo: 'application.addressUnit' },
  { label: 'City', mapsTo: 'application.addressCity' },
  { label: 'Postal code', mapsTo: 'application.addressPostalCode' },
  { label: 'Project name', mapsTo: 'application.projectTitle' },
  { label: 'Description of work', mapsTo: 'application.projectDescription' },
  { label: 'Estimated project cost ($)', mapsTo: 'application.estimatedJobValueDollars' },
  { label: 'Area of work (m²)', mapsTo: 'application.squareFootage' },
  { label: 'Contractor company', mapsTo: 'contractor.companyName' },
  { label: 'Contractor licence number', mapsTo: 'contractor.primaryLicenseNumber' },
  { label: 'Applicant name', mapsTo: 'applicant.fullName' },
  { label: 'Applicant email', mapsTo: 'applicant.email' },
];

export interface PortalAnswer {
  label: string;
  value: string | null;
  /** Read from the documents with less confidence than a form would be filled with. */
  needsCheck: boolean;
}

export function portalAnswers(context: FieldResolutionContext): PortalAnswer[] {
  return PORTAL_ANSWER_FIELDS.map(({ label, mapsTo }) => {
    const resolved = resolveFieldValue(mapsTo, context);
    const value = resolved.value?.trim() ? resolved.value.trim() : null;
    return { label, value, needsCheck: value !== null && resolved.confidence < PDF_FILL_MIN_CONFIDENCE };
  });
}

/** "Label: value" lines for pasting into notes or an email; blanks are left out. */
export function portalAnswersText(answers: PortalAnswer[]): string {
  return answers
    .filter((answer) => answer.value !== null)
    .map((answer) => `${answer.label}: ${answer.value}`)
    .join('\n');
}
