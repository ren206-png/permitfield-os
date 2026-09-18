import { notFound } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/org-context';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { createClient } from '@/lib/supabase/server';
import { getOrgTaxProfile } from '@/lib/quotes-payments/org-tax-profile';
import { LockedFeature } from '@/components/locked-feature';
import { TaxProfileForm } from './tax-profile-form';

// Gate 4 (Quotes & Payments), Phase A. Flag-gated the same way every other
// flag-gated page in this codebase is (see app/(app)/settings/billing/
// page.tsx's header comment) -- notFound() means this route doesn't exist
// at all with PERMITFIELD_FF_QUOTES_PAYMENTS off.
//
// Entitlement gate (in addition to the flag): only orgs with the
// 'invoices.manage' entitlement can view/edit this page -- see
// lib/quotes-payments/org-tax-profile.ts's header comment on why that
// entitlement, specifically, is used here. This is the UI-level half of the
// double gate the task requires; actions.ts's upsertTaxProfileAction (via
// upsertOrgTaxProfile()) re-checks it again, and org_tax_profiles' own RLS
// (is_org_billing_manager()) is the final, real enforcement layer no UI
// check can bypass.
export default async function TaxProfilePage() {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'invoices.manage');

  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Tax profile unavailable"
        message="Your organization's plan does not include Quotes & Payments billing configuration."
      />
    );
  }

  const supabase = await createClient();
  const profile = await getOrgTaxProfile(supabase, orgId);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900">Organization tax profile</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Legal/billing details used on every estimate and invoice, and GST/HST + BC PST registration status used to
        compute tax. GST/HST and BC PST are tracked independently -- one is never inferred from the other.
      </p>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <TaxProfileForm profile={profile} />
      </div>
    </div>
  );
}
