'use server';

import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { upsertOrgTaxProfile } from '@/lib/quotes-payments/org-tax-profile';
import type { TaxRegistrationStatus } from '@/lib/tax/types';

// Gate 4 (Quotes & Payments), Phase A. Re-checks isQuotesPaymentsEnabled()
// as its first statement even though the page already gates on it -- same
// "a Server Action is a public, directly-invokable endpoint on its own"
// discipline app/(app)/settings/billing/actions.ts's header comment
// documents. upsertOrgTaxProfile() itself re-checks the flag AND the
// 'invoices.manage' entitlement a second time (this module's own second
// layer of the double gate), and org_tax_profiles' RLS is the final,
// un-bypassable layer underneath both.
export interface TaxProfileActionState {
  error?: string;
  success?: boolean;
}

const REGISTRATION_STATUSES: readonly TaxRegistrationStatus[] = ['unregistered', 'registered', 'unknown'];

function parseStatus(raw: FormDataEntryValue | null): TaxRegistrationStatus | null {
  const value = String(raw ?? '');
  return (REGISTRATION_STATUSES as readonly string[]).includes(value) ? (value as TaxRegistrationStatus) : null;
}

export async function upsertTaxProfileAction(
  _prevState: TaxProfileActionState,
  formData: FormData
): Promise<TaxProfileActionState> {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId, userId, role } = await requireOrgContext();

  const legalName = String(formData.get('legalName') ?? '').trim();
  const tradingName = String(formData.get('tradingName') ?? '').trim();
  const addressLine1 = String(formData.get('addressLine1') ?? '').trim();
  const addressLine2 = String(formData.get('addressLine2') ?? '').trim();
  const city = String(formData.get('city') ?? '').trim();
  const provinceCode = String(formData.get('provinceCode') ?? '').trim().toUpperCase();
  const postalCode = String(formData.get('postalCode') ?? '').trim();
  const invoiceContactName = String(formData.get('invoiceContactName') ?? '').trim();
  const invoiceContactEmail = String(formData.get('invoiceContactEmail') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();
  const gstHstNumber = String(formData.get('gstHstNumber') ?? '').trim();
  const bcPstNumber = String(formData.get('bcPstNumber') ?? '').trim();

  if (!legalName) return { error: 'Legal name is required.' };
  if (!addressLine1) return { error: 'Address line 1 is required.' };
  if (!city) return { error: 'City is required.' };
  if (provinceCode.length !== 2) return { error: 'Province code must be exactly 2 letters (e.g. ON, BC, AB).' };
  if (!postalCode) return { error: 'Postal code is required.' };
  if (timezone && !timezone.includes('/')) {
    return { error: 'Timezone must be an IANA zone name (e.g. America/Toronto).' };
  }

  const gstHstStatus = parseStatus(formData.get('gstHstStatus'));
  const bcPstStatus = parseStatus(formData.get('bcPstStatus'));
  if (!gstHstStatus) return { error: 'Select a valid GST/HST status.' };
  if (!bcPstStatus) return { error: 'Select a valid BC PST status.' };

  // Same "registered without a number is very likely incomplete data
  // entry" nudge the DB's own CHECK constraint enforces
  // (20260806000051_org_tax_profiles.sql) -- validated here too so the
  // error surfaces as a field-level message rather than a raw Postgres
  // CHECK-violation string.
  if (gstHstStatus === 'registered' && !gstHstNumber) {
    return { error: 'A GST/HST number is required when status is "Registered".' };
  }
  if (bcPstStatus === 'registered' && !bcPstNumber) {
    return { error: 'A BC PST number is required when status is "Registered".' };
  }

  const supabase = await createClient();

  try {
    await upsertOrgTaxProfile(supabase, {
      orgId,
      legalName,
      tradingName: tradingName || null,
      addressLine1,
      addressLine2: addressLine2 || null,
      city,
      provinceCode,
      postalCode,
      invoiceContactName: invoiceContactName || null,
      invoiceContactEmail: invoiceContactEmail || null,
      timezone: timezone || null,
      gstHstStatus,
      gstHstNumber: gstHstNumber || null,
      bcPstStatus,
      bcPstNumber: bcPstNumber || null,
      actorUserId: userId,
      actorRole: role,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to save the tax profile.' };
  }

  revalidatePath('/settings/tax-profile');
  return { success: true };
}
