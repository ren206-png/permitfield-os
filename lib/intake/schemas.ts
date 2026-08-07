import { z } from 'zod';

// Lifecycle & Compliance Expansion, Phase 1.1: Zod schemas for the project
// intake flow (app/(app)/projects/new/actions.ts). Same division of labor
// as every other schema in this codebase (see lib/ai/schemas/extraction.ts's
// header comment): Postgres CHECK constraints in
// 20260806000019_lifecycle_intake_properties_clients_taxonomies.sql catch
// structural corruption (e.g. province_code must be 2 uppercase letters);
// this file owns business-rule validation with actually-good error
// messages (e.g. "must be a real Canadian province/territory code", not
// just "2 letters"), and normalizes input into the canonical stored shape
// (uppercase province, "A1A 1A1"-spaced postal code) so every writer stores
// data the same way regardless of how a user typed it.

// SS0.5: no US-specific terminology pre-emptively. 13 Canadian provinces and
// territories -- the full ISO 3166-2:CA set, not just the 10 provinces.
export const CANADIAN_PROVINCE_CODES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
] as const;

export type CanadianProvinceCode = (typeof CANADIAN_PROVINCE_CODES)[number];

// A1A 1A1: letter-digit-letter, digit-letter-digit. D/F/I/O/Q/U and W/Z as a
// first character are technically excluded by Canada Post's real allocation
// rules, but this schema deliberately does not encode that finer table --
// same "don't fabricate precision you haven't verified" discipline
// PHASE_0_FINDINGS.md applies to seed data (see the migration's own comment
// on the ESA/Calgary form field maps): validating the general shape catches
// real typos without this codebase asserting a full, unverified
// first-letter allocation table it would need to keep in sync with Canada
// Post itself.
const CANADIAN_POSTAL_CODE_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

export const provinceCodeSchema = z
  .string()
  .trim()
  .transform((val) => val.toUpperCase())
  .refine((val): val is CanadianProvinceCode => (CANADIAN_PROVINCE_CODES as readonly string[]).includes(val), {
    message: `Province/territory must be one of: ${CANADIAN_PROVINCE_CODES.join(', ')}.`,
  });

export const postalCodeSchema = z
  .string()
  .trim()
  .transform((val) => val.toUpperCase().replace(/[\s-]+/g, ''))
  .refine((val) => CANADIAN_POSTAL_CODE_RE.test(val), {
    message: 'Postal code must be a valid Canadian format (e.g. M5V 2T6).',
  })
  // Normalized storage: always "A1A 1A1" (one space, uppercase) regardless
  // of whether the user typed a space, a dash, or nothing.
  .transform((val) => `${val.slice(0, 3)} ${val.slice(3)}`);

// Turns an empty/whitespace-only string into `undefined` before the wrapped
// schema runs, so an optional field left blank in a <form> (which always
// submits a string, never truly absent) validates as "not provided" instead
// of failing the wrapped schema's own rules (e.g. an empty string is not a
// valid province code, but "not provided" is fine for an optional field).
function optionalText(schema: z.ZodString = z.string()) {
  return z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length === 0 ? undefined : val),
    schema.trim().optional()
  );
}

function optionalUuid() {
  return z.preprocess(
    (val) => (typeof val === 'string' && val.trim().length === 0 ? undefined : val),
    z.string().uuid('Must be a valid id.').optional()
  );
}

const optionalProvinceCode = z.preprocess(
  (val) => (typeof val === 'string' && val.trim().length === 0 ? undefined : val),
  provinceCodeSchema.optional()
);

const optionalPostalCode = z.preprocess(
  (val) => (typeof val === 'string' && val.trim().length === 0 ? undefined : val),
  postalCodeSchema.optional()
);

const optionalEmail = z.preprocess(
  (val) => (typeof val === 'string' && val.trim().length === 0 ? undefined : val),
  z.string().trim().email('Must be a valid email address.').optional()
);

// Standalone client/property schemas -- not wired to a dedicated
// /clients/new or /properties/new page in this gate (out of scope, see the
// Phase 1.1 report's "What's NOT done" section), but kept as their own
// exported, independently testable schemas rather than inlined only inside
// CreateProjectFormSchema below, since the inline-creation fields on that
// form schema reuse these same field-level rules (province/postal/email)
// but as optional (a project can be created before a property/client
// exists at all -- see the migration's header comment on nullable FKs).

export const ClientInputSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required.'),
  email: optionalEmail,
  phone: optionalText(),
  notes: optionalText(),
});

export type ClientInput = z.infer<typeof ClientInputSchema>;

export const PropertyInputSchema = z.object({
  clientId: optionalUuid(),
  addressLine1: z.string().trim().min(1, 'Address is required.'),
  addressLine2: optionalText(),
  city: z.string().trim().min(1, 'City is required.'),
  provinceCode: provinceCodeSchema,
  postalCode: postalCodeSchema,
  legalDescription: optionalText(),
});

export type PropertyInput = z.infer<typeof PropertyInputSchema>;

// Matches project_status (20260806000019) exactly -- kept as a parallel Zod
// enum rather than importing the Postgres type (this codebase has no
// generated-types step yet, see PHASE_0_FINDINGS.md), same convention every
// other status-shaped field in this codebase already follows.
export const PROJECT_STATUS_VALUES = ['draft', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

// The single form schema behind app/(app)/projects/new/. Scoped per this
// gate's minimal-UI decision (no separate client/property create pages
// exist yet -- see the Phase 1.1 report): a client and/or property can be
// created inline, in the same submission, alongside the project itself.
// Both are fully optional (a project can exist with neither yet assigned --
// see the migration's header comment on nullable client_id/property_id),
// but if ANY property address field is filled in, all four required
// address fields must be present together -- enforced below via
// `superRefine` rather than each field independently, since "half an
// address" is worse than "no address" (an unusable partial property row).
export const CreateProjectFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Project title is required.'),
    description: optionalText(),
    taxonomyId: optionalUuid(),
    propertyOwnerName: optionalText(),
    applicantName: optionalText(),
    status: z.enum(PROJECT_STATUS_VALUES).default('draft'),

    clientName: optionalText(),
    clientEmail: optionalEmail,
    clientPhone: optionalText(),

    addressLine1: optionalText(),
    addressLine2: optionalText(),
    city: optionalText(),
    provinceCode: optionalProvinceCode,
    postalCode: optionalPostalCode,
  })
  .superRefine((data, ctx) => {
    const addressFields = [data.addressLine1, data.city, data.provinceCode, data.postalCode];
    const anyProvided = addressFields.some((f) => f !== undefined);
    const allProvided = addressFields.every((f) => f !== undefined);
    if (anyProvided && !allProvided) {
      ctx.addIssue({
        code: 'custom',
        message: 'Address line 1, city, province, and postal code are all required together to add a property.',
        path: ['addressLine1'],
      });
    }
  });

export type CreateProjectFormInput = z.infer<typeof CreateProjectFormSchema>;
