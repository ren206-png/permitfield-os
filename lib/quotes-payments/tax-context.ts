// Gate 4 (Quotes & Payments), Phase A service layer -- resolves an org's
// org_tax_profiles row (20260806000044_org_tax_profiles.sql) into the
// `OrgTaxContext` shape lib/tax/engine.ts's calculateTax() consumes.
//
// The master-prompt requirement this file exists to satisfy: "read that row
// yourself, don't assume it exists, handle the 'org has no tax profile yet'
// case explicitly." An org that predates this migration, or simply hasn't
// completed tax-profile setup, has ZERO rows in org_tax_profiles (it's a
// nullable 1:1, not a row created automatically for every org) -- that is
// NOT the same case as a profile that exists with gst_hst_status/
// bc_pst_status = 'unknown' (a deliberate, already-modeled value on the
// enum), so this module surfaces it as its own distinct
// `{ status: 'missing_profile' }' outcome rather than synthesizing a fake
// OrgTaxContext (e.g. an empty provinceCode) and letting calculateTax()'s
// unrelated 'unsupported_province' check accidentally catch it -- that
// would produce a misleading reason code for what is actually a completely
// different problem (no profile at all vs. a known-but-unresolved
// registration status).
import type { QPClient } from './types';
import type { OrgTaxContext, TaxRegistrationStatus } from '@/lib/tax/types';

export interface OrgTaxProfileRecord {
  id: string;
  orgId: string;
  legalName: string;
  tradingName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: string;
  invoiceContactName: string | null;
  invoiceContactEmail: string | null;
  currencyCode: string;
  gstHstStatus: TaxRegistrationStatus;
  gstHstNumber: string | null;
  bcPstStatus: TaxRegistrationStatus;
  bcPstNumber: string | null;
}

export type OrgTaxContextResolution =
  | { status: 'ok'; profile: OrgTaxProfileRecord; context: OrgTaxContext }
  | { status: 'missing_profile' };

const ORG_TAX_PROFILE_COLUMNS =
  'id, org_id, legal_name, trading_name, address_line1, address_line2, city, province_code, postal_code, country_code, invoice_contact_name, invoice_contact_email, currency_code, gst_hst_status, gst_hst_number, bc_pst_status, bc_pst_number';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProfileRow(row: any): OrgTaxProfileRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    legalName: row.legal_name,
    tradingName: row.trading_name ?? null,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 ?? null,
    city: row.city,
    provinceCode: row.province_code,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    invoiceContactName: row.invoice_contact_name ?? null,
    invoiceContactEmail: row.invoice_contact_email ?? null,
    currencyCode: row.currency_code,
    gstHstStatus: row.gst_hst_status,
    gstHstNumber: row.gst_hst_number ?? null,
    bcPstStatus: row.bc_pst_status,
    bcPstNumber: row.bc_pst_number ?? null,
  };
}

/**
 * Reads org_tax_profiles for `orgId`. Throws on a real query error
 * (connection failure, RLS-denied, etc. -- an error the caller must not
 * silently swallow); returns `{ status: 'missing_profile' }` when the query
 * succeeds but finds no row at all, distinctly from `'unknown'` status
 * values on an existing row (see this file's header comment).
 */
export async function resolveOrgTaxContext(supabase: QPClient, orgId: string): Promise<OrgTaxContextResolution> {
  const { data, error } = await supabase
    .from('org_tax_profiles')
    .select(ORG_TAX_PROFILE_COLUMNS)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load org_tax_profiles for org ${orgId}: ${error.message}`);
  }
  if (!data) {
    return { status: 'missing_profile' };
  }

  const profile = mapProfileRow(data);
  const context: OrgTaxContext = {
    provinceCode: profile.provinceCode,
    gstHstStatus: profile.gstHstStatus,
    bcPstStatus: profile.bcPstStatus,
  };
  return { status: 'ok', profile, context };
}
