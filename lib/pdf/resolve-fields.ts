import { PermitExtractionSchema, type PermitExtraction } from '@/lib/ai/schemas/extraction';
import { centsToDollarsString } from '@/lib/money/cents';
import { PDF_FILL_MIN_CONFIDENCE } from './config';

// Field-value resolution: turns a permit_form_fields.maps_to dotted path
// (e.g. 'applicant.lastName') into an actual value to type onto a PDF, drawn
// from three sources with three different trust levels --
//   - extractions.parsed_data (AI-extracted, each field carries its own
//     confidence -- SS4.2)
//   - contractors (structured, human-entered data -- always confidence 1,
//     it was never guessed)
//   - permit_applications (deterministic fields the application itself
//     already knows, e.g. project_title, estimated_job_value_cents --
//     also always confidence 1)
// -- gated by PDF_FILL_MIN_CONFIDENCE (lib/pdf/config.ts) so a low-confidence
// AI-extracted value is never typed onto a legal government form (SS1).

export interface FieldResolutionContext {
  // null when extractions.parsed_data was missing, or failed re-validation
  // against PermitExtractionSchema -- buildFieldResolutionContext degrades
  // to this rather than throwing, matching lib/inngest/functions/audit.ts's
  // own "never trust the jsonb column's shape blindly" discipline, but here
  // a re-parse failure means "no AI-extracted fields are available", not a
  // hard error -- application/contractor-sourced fields can still resolve.
  extraction: PermitExtraction | null;
  estimatedJobValueCents: number | null;
  application: {
    projectTitle: string | null;
  };
  contractor: {
    companyName: string | null;
    primaryLicenseNumber: string | null;
    licenseProvinceCode: string | null;
  } | null;
}

export interface ResolvedField {
  value: string | null;
  confidence: number;
}

const NO_VALUE: ResolvedField = { value: null, confidence: 0 };

// Deterministic (non-AI) name-splitting heuristic: last whitespace-separated
// token is the last name, everything before it is the first name. A
// single-token name (e.g. a mononym, or a garbled extraction) has no
// first name at all rather than guessing -- returning '' would type an
// empty-but-present string onto the form, which is not the same as leaving
// the field honestly blank. Known limitation: does not handle multi-word
// surnames (e.g. "van der Berg") correctly; documented in the Phase 4
// adversarial self-check / README rather than silently assumed correct.
export function splitApplicantName(fullName: string): { firstName: string | null; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length <= 1) {
    return { firstName: null, lastName: parts[0] ?? '' };
  }
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  return { firstName, lastName };
}

function fromExtractedField(
  field: { value: string | number | null; confidence: number } | undefined
): ResolvedField {
  if (!field || field.value === null) return NO_VALUE;
  return { value: String(field.value), confidence: field.confidence };
}

type Resolver = (context: FieldResolutionContext) => ResolvedField;

// One explicit entry per known maps_to path, same "one clear place, easy to
// extend" convention as lib/ai/config.ts's constants. Every
// permit_form_fields.maps_to value in this codebase (seed or future) must
// have a matching entry here -- resolveFieldValue throws for anything else,
// deliberately, rather than silently resolving to blank (a typo'd maps_to
// path should fail the generation run loudly, not produce a PDF that's
// blank for a reason nobody can see).
const FIELD_RESOLVERS: Record<string, Resolver> = {
  'applicant.firstName': (ctx) => {
    const name = ctx.extraction?.applicant_name;
    if (!name || name.value === null) return NO_VALUE;
    const { firstName } = splitApplicantName(name.value);
    if (firstName === null) return NO_VALUE;
    return { value: firstName, confidence: name.confidence };
  },
  'applicant.lastName': (ctx) => {
    const name = ctx.extraction?.applicant_name;
    if (!name || name.value === null) return NO_VALUE;
    const { lastName } = splitApplicantName(name.value);
    return { value: lastName, confidence: name.confidence };
  },
  'applicant.licenseNumber': (ctx) => fromExtractedField(ctx.extraction?.license_number),
  'application.estimatedJobValueDollars': (ctx) => {
    if (ctx.estimatedJobValueCents === null) return NO_VALUE;
    // The dollar VALUE is deterministic once cents is known (BigInt string
    // math, lib/money/cents.ts), but the underlying number still came from
    // an AI-extracted, printed-on-the-document string
    // (estimated_job_value_raw) -- so this field's confidence tracks that
    // extraction's confidence, not a flat 1. A confidently-computed
    // conversion of an uncertain input is still an uncertain output.
    const confidence = ctx.extraction?.estimated_job_value_raw?.confidence ?? 0;
    return { value: centsToDollarsString(BigInt(ctx.estimatedJobValueCents)), confidence };
  },
  'application.projectTitle': (ctx) =>
    ctx.application.projectTitle ? { value: ctx.application.projectTitle, confidence: 1 } : NO_VALUE,
  'application.squareFootage': (ctx) => fromExtractedField(ctx.extraction?.square_footage),
  'application.electricalAmps': (ctx) => fromExtractedField(ctx.extraction?.electrical_amps),
  'application.scopeOfWorkSummary': (ctx) => fromExtractedField(ctx.extraction?.scope_of_work_summary),
  'contractor.companyName': (ctx) =>
    ctx.contractor?.companyName ? { value: ctx.contractor.companyName, confidence: 1 } : NO_VALUE,
  'contractor.primaryLicenseNumber': (ctx) =>
    ctx.contractor?.primaryLicenseNumber
      ? { value: ctx.contractor.primaryLicenseNumber, confidence: 1 }
      : NO_VALUE,
  'contractor.licenseProvinceCode': (ctx) =>
    ctx.contractor?.licenseProvinceCode
      ? { value: ctx.contractor.licenseProvinceCode, confidence: 1 }
      : NO_VALUE,
};

export function resolveFieldValue(mapsToPath: string, context: FieldResolutionContext): ResolvedField {
  const resolver = FIELD_RESOLVERS[mapsToPath];
  if (!resolver) {
    throw new Error(
      `Unknown maps_to path "${mapsToPath}" -- lib/pdf/resolve-fields.ts (FIELD_RESOLVERS) has no resolver registered for it. Every permit_form_fields.maps_to value must have a matching entry.`
    );
  }
  return resolver(context);
}

/**
 * Resolves a field and applies the PDF_FILL_MIN_CONFIDENCE gate in one call
 * -- what lib/inngest/functions/generate-pdf.ts actually uses per field.
 * Returns the value to fill (or null, meaning "leave blank"), plus whether
 * blank-ness was caused by a below-threshold confidence specifically (as
 * opposed to no data existing at all) -- useful for logging/debugging, not
 * currently persisted as a separate DB column (generated_documents just
 * records the maps_to path either way).
 */
export function resolveFieldForFilling(
  mapsToPath: string,
  context: FieldResolutionContext
): { value: string | null; belowConfidenceThreshold: boolean } {
  const resolved = resolveFieldValue(mapsToPath, context);
  if (resolved.value === null) {
    return { value: null, belowConfidenceThreshold: false };
  }
  if (resolved.confidence < PDF_FILL_MIN_CONFIDENCE) {
    return { value: null, belowConfidenceThreshold: true };
  }
  return { value: resolved.value, belowConfidenceThreshold: false };
}

/**
 * Builds a FieldResolutionContext from raw DB rows. Re-parses parsed_data
 * through PermitExtractionSchema rather than trusting the jsonb column's
 * shape blindly (same discipline as lib/inngest/functions/audit.ts's own
 * re-parse) -- this also strips the estimated_job_value_cents field
 * extract.ts spliced on top of the schema's own fields (Zod objects strip
 * unknown keys by default), which is why estimatedJobValueCents is passed
 * in separately rather than read back out of the re-parsed extraction.
 */
export function buildFieldResolutionContext(params: {
  parsedData: Record<string, unknown> | null;
  estimatedJobValueCents: number | null;
  projectTitle: string | null;
  contractor: {
    company_name: string | null;
    primary_license_number: string | null;
    license_province_code: string | null;
  } | null;
}): FieldResolutionContext {
  let extraction: PermitExtraction | null = null;
  if (params.parsedData) {
    const result = PermitExtractionSchema.safeParse(params.parsedData);
    extraction = result.success ? result.data : null;
  }

  return {
    extraction,
    estimatedJobValueCents: params.estimatedJobValueCents,
    application: { projectTitle: params.projectTitle },
    contractor: params.contractor
      ? {
          companyName: params.contractor.company_name,
          primaryLicenseNumber: params.contractor.primary_license_number,
          licenseProvinceCode: params.contractor.license_province_code,
        }
      : null,
  };
}
