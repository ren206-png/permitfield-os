// Gate 4 (Quotes & Payments), Phase A service layer -- additive helper.
//
// lib/quotes-payments/tax-context.ts's resolveOrgTaxContext() is
// read-only-for-a-purpose: it exists solely to feed lib/tax/engine.ts's
// calculateTax(), so its OrgTaxProfileRecord projection intentionally omits
// columns calculateTax() never needs (timezone, the two *_effective_date
// columns, review_status, created_at/updated_at) -- see that file's own
// header comment. A Settings UI that lets an org view/edit its full
// org_tax_profiles row needs all of those, and needs a write path, neither
// of which belongs bolted onto a module whose whole point is staying a
// narrow, single-purpose read for the tax engine. Hence this separate file,
// following the exact conventions estimates.ts/invoices.ts/payments.ts
// already establish for this directory (flag + entitlement gate first,
// writeAuditLog() after a successful write, mapped row interface, no
// generated DB types).
//
// Entitlement choice: org_tax_profiles has no `org_tax_profiles.manage`
// entry in lib/billing/tiers.ts's Entitlement union (Phase A never defined
// one -- the master prompt's entitlement list only covers
// quotes/invoices/payments), and RLS itself is the real gate here
// (org_tax_profiles_insert/_update both require is_org_billing_manager(),
// 20260806000051_org_tax_profiles.sql) so a member without that role gets a
// thrown Postgres RLS error regardless of what this module checks. This
// module therefore gates only on isQuotesPaymentsEnabled() (the tax profile
// is Gate 4 scope, not a standalone feature) plus 'invoices.manage' as the
// nearest existing entitlement to "can administer this org's Quotes &
// Payments billing configuration" -- flagged here rather than silently
// picked, since the master prompt's entitlement list didn't anticipate this
// file.
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { writeAuditLog } from '@/lib/audit/log';
import type { Role } from '@/lib/authz';
import type { TaxRegistrationStatus } from '@/lib/tax/types';
import { QuotesPaymentsDisabledError, InsufficientEntitlementError } from './estimates';
import type { QPClient } from './types';

async function assertTaxProfileEntitlement(orgId: string): Promise<void> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }
  if (!(await can(orgId, 'invoices.manage'))) {
    throw new InsufficientEntitlementError(orgId, 'invoices.manage');
  }
}

export type TaxProfileReviewStatus = 'unreviewed' | 'reviewed' | 'needs_attention';

export interface OrgTaxProfileFullRecord {
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
  timezone: string | null;
  gstHstStatus: TaxRegistrationStatus;
  gstHstNumber: string | null;
  gstHstEffectiveDate: string | null;
  bcPstStatus: TaxRegistrationStatus;
  bcPstNumber: string | null;
  bcPstEffectiveDate: string | null;
  reviewStatus: TaxProfileReviewStatus;
  createdAt: string;
  updatedAt: string;
}

const FULL_COLUMNS =
  'id, org_id, legal_name, trading_name, address_line1, address_line2, city, province_code, postal_code, country_code, invoice_contact_name, invoice_contact_email, currency_code, timezone, gst_hst_status, gst_hst_number, gst_hst_effective_date, bc_pst_status, bc_pst_number, bc_pst_effective_date, review_status, created_at, updated_at';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFullProfileRow(row: any): OrgTaxProfileFullRecord {
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
    timezone: row.timezone ?? null,
    gstHstStatus: row.gst_hst_status,
    gstHstNumber: row.gst_hst_number ?? null,
    gstHstEffectiveDate: row.gst_hst_effective_date ?? null,
    bcPstStatus: row.bc_pst_status,
    bcPstNumber: row.bc_pst_number ?? null,
    bcPstEffectiveDate: row.bc_pst_effective_date ?? null,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reads the org's full org_tax_profiles row, or `null` if none exists yet
 * (same "no row is a legitimate, non-error state" posture as
 * resolveOrgTaxContext()'s `missing_profile` outcome -- this is a nullable
 * 1:1, not a row every org is guaranteed to have).
 */
export async function getOrgTaxProfile(supabase: QPClient, orgId: string): Promise<OrgTaxProfileFullRecord | null> {
  if (!isQuotesPaymentsEnabled()) {
    throw new QuotesPaymentsDisabledError();
  }

  const { data, error } = await supabase.from('org_tax_profiles').select(FULL_COLUMNS).eq('org_id', orgId).maybeSingle();
  if (error) {
    throw new Error(`Failed to load org_tax_profiles for org ${orgId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapFullProfileRow(data);
}

export interface UpsertOrgTaxProfileParams {
  orgId: string;
  legalName: string;
  tradingName?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
  invoiceContactName?: string | null;
  invoiceContactEmail?: string | null;
  timezone?: string | null;
  gstHstStatus: TaxRegistrationStatus;
  gstHstNumber?: string | null;
  gstHstEffectiveDate?: string | null;
  bcPstStatus: TaxRegistrationStatus;
  bcPstNumber?: string | null;
  bcPstEffectiveDate?: string | null;
  actorUserId: string;
  actorRole: Role;
}

/**
 * Creates or updates the org's org_tax_profiles row (upsert on the
 * `org_id` unique constraint -- see 20260806000051's `org_id uuid not null
 * unique`). `country_code`/`currency_code` are never accepted as params:
 * both are CHECK-pinned to 'CA'/'CAD' at the DB layer for this launch scope
 * (that migration's own header comment), so this function relies on the
 * column defaults rather than accepting values that could only ever be one
 * thing. RLS (`org_tax_profiles_insert`/`_update`, both
 * `is_org_billing_manager(org_id)`) is the real enforcement for "who may
 * write this row" -- a caller without that role gets a thrown Postgres
 * error from the upsert itself, not a check duplicated here.
 */
export async function upsertOrgTaxProfile(
  supabase: QPClient,
  params: UpsertOrgTaxProfileParams
): Promise<OrgTaxProfileFullRecord> {
  await assertTaxProfileEntitlement(params.orgId);

  const { data, error } = await supabase
    .from('org_tax_profiles')
    .upsert(
      {
        org_id: params.orgId,
        legal_name: params.legalName,
        trading_name: params.tradingName ?? null,
        address_line1: params.addressLine1,
        address_line2: params.addressLine2 ?? null,
        city: params.city,
        province_code: params.provinceCode,
        postal_code: params.postalCode,
        invoice_contact_name: params.invoiceContactName ?? null,
        invoice_contact_email: params.invoiceContactEmail ?? null,
        timezone: params.timezone ?? null,
        gst_hst_status: params.gstHstStatus,
        gst_hst_number: params.gstHstNumber ?? null,
        gst_hst_effective_date: params.gstHstEffectiveDate ?? null,
        bc_pst_status: params.bcPstStatus,
        bc_pst_number: params.bcPstNumber ?? null,
        bc_pst_effective_date: params.bcPstEffectiveDate ?? null,
      },
      { onConflict: 'org_id' }
    )
    .select(FULL_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert org_tax_profiles for org ${params.orgId}: ${error?.message ?? 'no row returned'}`);
  }

  const profile = mapFullProfileRow(data);

  const { error: auditError } = await writeAuditLog(supabase, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: 'org_tax_profile.updated',
    entityType: 'org_tax_profiles',
    entityId: profile.id,
    afterSummary: {
      gstHstStatus: profile.gstHstStatus,
      bcPstStatus: profile.bcPstStatus,
      provinceCode: profile.provinceCode,
    },
  });
  if (auditError) {
    console.error(`Failed to write audit log for org_tax_profile.updated (org ${params.orgId}): ${auditError}`);
  }

  return profile;
}
