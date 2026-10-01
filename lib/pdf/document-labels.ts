// Human-readable names for generated documents and their blank fields on the
// application page, instead of `<filing uuid>-filled.pdf` and raw maps_to keys.

const FIELD_LABELS: Record<string, string> = {
  'applicant.email': 'applicant email',
  'applicant.fullName': 'applicant name',
  'applicant.firstName': 'applicant first name',
  'applicant.lastName': 'applicant last name',
  'application.projectAddress': 'project address',
  'application.projectTitle': 'project name',
  'application.projectDescription': 'description of work',
  'application.addressCivicNumber': 'civic number',
  'application.addressStreet': 'street',
  'application.addressCity': 'city',
  'application.electricalAmps': 'electrical amps',
  'application.estimatedJobValueDollars': 'estimated value',
  'contractor.companyName': 'contractor company',
  'contractor.primaryLicenseNumber': 'licence number',
};

export function fieldLabel(mapsTo: string): string {
  return FIELD_LABELS[mapsTo] ?? mapsTo.split('.').pop()!.replace(/([A-Z])/g, ' $1').toLowerCase();
}

const FILENAME_PATTERN = /^([0-9a-f-]{36})-(filled|signed|signed-upload)\.pdf$/;

/** "City of Vancouver form (signed)" from `<filing id>-signed.pdf`, given filing id → authority name. */
export function generatedDocumentLabel(filename: string, authorityByFiling: Map<string, string>): string {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) return filename;
  const authority = authorityByFiling.get(match[1]);
  const base = authority ? `${authority} form` : 'Filled form';
  if (match[2] === 'signed') return `${base} (signed)`;
  if (match[2] === 'signed-upload') return `${base} (signed copy, uploaded)`;
  return base;
}
