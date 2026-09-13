'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { resolveTargetToken } from '@/lib/bridge/client-portal';
import { createServiceClient } from '@/lib/supabase/service-client';
import { recordEstimateAcceptance } from '@/lib/quotes-payments/estimate-acceptances';
import { dbValueToCents } from '@/lib/quotes-payments/db-mapping';

// Gate 4 (Quotes & Payments), Phase A -- "Accept" action for
// app/estimate/[token]/page.tsx. Same generic-failure discipline
// resolveTargetToken() itself uses (see that function's header comment in
// lib/bridge/client-portal.ts): every token-validation failure below
// collapses to GENERIC_ERROR, indistinguishable from any other. The one
// deliberate exception is the stale-revision case (STALE_REVISION_MESSAGE
// below) -- that is not a token-validation failure, it is a real state
// change the visitor caused by sitting on an open tab while staff sent a
// new revision, and telling them so (rather than a generic "link
// unavailable") is the only way they can recover (refresh and re-review).
const GENERIC_ERROR = 'This link is no longer available. Please contact the sender for an updated link.';

export interface AcceptEstimateState {
  error?: string;
  accepted?: boolean;
}

export async function acceptEstimateAction(
  _prevState: AcceptEstimateState,
  formData: FormData
): Promise<AcceptEstimateState> {
  const token = String(formData.get('token') ?? '').trim();
  const typedName = String(formData.get('typedName') ?? '').trim();
  const claimedAuthority = String(formData.get('claimedAuthority') ?? '').trim();

  if (!token) {
    return { error: GENERIC_ERROR };
  }
  if (!typedName || !claimedAuthority) {
    return { error: 'Enter your full name and your role/title to accept this estimate.' };
  }

  // Re-validated here, independently of whatever the page component checked
  // moments ago when it rendered -- this action has no access to that
  // render's result and must never trust it implicitly (same "the caller
  // must validate first" contract estimate-acceptances.ts's own header
  // comment states record_estimate_acceptance() itself does NOT enforce).
  const resolved = await resolveTargetToken(token, 'estimate');
  if ('error' in resolved) {
    return { error: GENERIC_ERROR };
  }
  const { orgId, targetId, tokenId, recipientName, recipientEmailDisplay } = resolved;

  // Trust boundary: this service-role client is constructed only after the
  // resolveTargetToken() call above succeeded, matching
  // lib/supabase/service-client.ts's "Exception 2" contract -- every query
  // below is scoped by the orgId/targetId that call returned, never by a
  // request-supplied value.
  const supabase = createServiceClient();

  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .select('id, status, current_revision_id, scope_notes, exclusions, terms')
    .eq('id', targetId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (estimateError || !estimate) {
    return { error: GENERIC_ERROR };
  }
  if (estimate.status !== 'sent' || !estimate.current_revision_id) {
    return { error: 'This estimate is no longer open for acceptance.' };
  }

  const { data: revision, error: revisionError } = await supabase
    .from('estimate_revisions')
    .select('id, line_items, subtotal_cents, discount_total_cents, tax_total_cents, total_cents')
    .eq('id', estimate.current_revision_id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (revisionError || !revision) {
    return { error: GENERIC_ERROR };
  }

  // revisionHash: a content fingerprint record_estimate_acceptance() stores
  // verbatim without re-verifying it against anything (confirmed by reading
  // that RPC's full SQL body, 20260806000046_estimate_acceptances.sql) --
  // computed fresh here from the revision's own stored jsonb + four *_cents
  // columns, mirroring lib/quotes-payments/invoices.ts's issueInvoice()
  // documentHash computation exactly: sha256 of a deterministic
  // JSON.stringify of `{ lineItems, totals }`, all cents already plain
  // numbers (never BigInt) so the hash input is JSON-safe.
  const totals = {
    subtotal_cents: Number(dbValueToCents(revision.subtotal_cents)),
    discount_total_cents: Number(dbValueToCents(revision.discount_total_cents)),
    tax_total_cents: Number(dbValueToCents(revision.tax_total_cents)),
    total_cents: Number(dbValueToCents(revision.total_cents)),
  };
  const revisionHash = createHash('sha256')
    .update(JSON.stringify({ lineItems: revision.line_items, totals }), 'utf8')
    .digest('hex');

  // No existing repo convention extracts request ip/user-agent inside a
  // Server Action (grepped app/ and lib/ for x-forwarded-for/headers()/
  // request.ip/user-agent -- no relevant prior art found beyond unrelated
  // type-definition fields and app/robots.ts's own unrelated userAgent: '*'
  // field). next/headers's headers() is the standard Next.js primitive for
  // this and is used here as a from-scratch decision, not a mirrored
  // pattern.
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for');
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : null;
  const userAgent = requestHeaders.get('user-agent');

  const externalActorLabel = recipientName ? `${recipientName} <${recipientEmailDisplay}>` : recipientEmailDisplay;

  try {
    await recordEstimateAcceptance(supabase, {
      orgId,
      revisionId: revision.id,
      revisionHash,
      acceptedScopeSnapshot: {
        scopeNotes: estimate.scope_notes,
        exclusions: estimate.exclusions,
        terms: estimate.terms,
      },
      typedName,
      claimedAuthority,
      ip,
      userAgent,
      externalActorId: tokenId,
      externalActorLabel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // record_estimate_acceptance()'s stale-revision guard raises an
    // exception whose message begins with 'stale_revision:' (that migration's
    // own raise exception text) when `revision.id` is no longer
    // estimates.current_revision_id -- i.e. staff sent a newer revision
    // while this visitor had the page open. That is a real, actionable state
    // error, not a token-validation failure, so it gets its own message
    // rather than collapsing into GENERIC_ERROR (see this file's header
    // comment).
    if (message.includes('stale_revision')) {
      return {
        error: 'This estimate has changed since you opened this page. Please refresh and review the latest version before accepting.',
      };
    }
    console.error(`acceptEstimateAction failed for revision ${revision.id}: ${message}`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/estimate/${token}`);
  return { accepted: true };
}
