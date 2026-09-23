import type { createServiceClient } from '@/lib/supabase/service-client';
import { AI_ORG_MONTHLY_COST_CAP_USD_CENTS, AI_USER_DAILY_COST_CAP_USD_CENTS } from './config';

// Gate AI-1, sub-phase AI-1.4 (GATE_AI_1_FINDINGS.md §G/§H RUNAWAY_SPEND).
// isAiTokenCapsEnabled() (lib/flags.ts) was declared back in AI-1.1 with zero
// call sites -- this module, plus its wiring into
// lib/inngest/functions/classify-documents.ts, is the first real one.
//
// GATE_AI_1_FINDINGS.md §G's own framing ("this needs its own storage
// [that] presumably reads ai_token_ledger and aggregates... and needs to run
// *before* the adapter call, which means the router needs a pre-flight
// hook, not just a post-hoc log") is answered here as a pre-flight *check*
// a caller runs itself immediately before each model call, not a hook
// inside lib/ai/router.ts's routeAiTask() -- routeAiTask() is deliberately
// pure/synchronous/DB-free (its own header comment), and a cap check is
// inherently DB-dependent (it has to read ai_token_ledger) and org/user-
// scoped (routeAiTask() is given neither), so folding it in there would
// break that file's one deliberate property for no structural reason. A
// caller-side pre-flight check achieves the same "before the call, not
// after" guarantee without that cost.
//
// Split into a pure decision function (evaluateCostCap, unit-tested in
// cost-caps.test.ts, same "pure core / thin DB wrapper" split
// lib/ai/router.ts uses) and thin, untested DB-touching wrappers around it
// -- same division of testing effort this codebase already draws elsewhere
// (e.g. lib/ai/classify-document.ts's parseJsonResponse vs. its DB/network-
// touching caller in lib/inngest/functions/classify-documents.ts).

export interface CostCapCheckResult {
  withinCap: boolean;
  currentSpendCents: number;
  capCents: number;
}

/**
 * Pure comparison: is currentSpendCents (spend already recorded before this
 * call would be attempted) still under capCents? Deliberately a strict `<`,
 * not `<=` -- once spend already equals the cap, the *next* call is the one
 * that would push an org/user over it, so that next call is the one this
 * function must reject.
 */
export function evaluateCostCap(currentSpendCents: number, capCents: number): CostCapCheckResult {
  if (currentSpendCents < 0) {
    throw new Error(`evaluateCostCap requires a nonnegative currentSpendCents, got ${currentSpendCents}`);
  }
  return {
    withinCap: currentSpendCents < capCents,
    currentSpendCents,
    capCents,
  };
}

function currentUtcMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function currentUtcDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Sums ai_token_ledger.cost_usd_cents for one org since the start of the
 * current UTC calendar month, and compares it against
 * AI_ORG_MONTHLY_COST_CAP_USD_CENTS. Real, wired caller:
 * lib/inngest/functions/classify-documents.ts, checked before every
 * classify-call-model-* step it runs -- so a batch that starts under the cap
 * but crosses it mid-run (this same run's own already-committed ledger rows
 * count toward currentSpendCents, since each is inserted via its own
 * step.run() before the loop reaches its next document) stops attempting
 * further model calls partway through, not just on the next Inngest
 * invocation.
 *
 * service_role-only, same as every other ai_token_ledger reader in this
 * codebase (that table's own RLS restricts SELECT to can_read_ai_ledger()
 * roles, not service_role by default -- this call bypasses RLS entirely via
 * the caller-supplied client, same discipline as every other background-job
 * query in lib/inngest/functions/).
 */
export async function checkOrgMonthlyCostCap(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string
): Promise<CostCapCheckResult> {
  const { data, error } = await supabase
    .from('ai_token_ledger')
    .select('cost_usd_cents')
    .eq('org_id', orgId)
    .gte('created_at', currentUtcMonthStartIso());
  if (error) {
    throw new Error(`checkOrgMonthlyCostCap: failed to read ai_token_ledger for org ${orgId}: ${error.message}`);
  }

  const currentSpendCents = (data ?? []).reduce(
    (sum, row) => sum + (row as { cost_usd_cents: number }).cost_usd_cents,
    0
  );
  return evaluateCostCap(currentSpendCents, AI_ORG_MONTHLY_COST_CAP_USD_CENTS);
}

/**
 * Sums ai_token_ledger.cost_usd_cents for one user since the start of the
 * current UTC calendar day, and compares it against
 * AI_USER_DAILY_COST_CAP_USD_CENTS. ai_token_ledger has no user column of
 * its own (20260806000036's own header: a spend ledger is org-scoped, not
 * user-scoped, by design) -- the user who requested a job lives on
 * ai_jobs.requested_by_user_id instead, so this joins through ai_jobs via
 * the FK PostgREST already knows about (ai_token_ledger.job_id references
 * ai_jobs.id).
 *
 * NO CALLER YET -- see lib/ai/config.ts's AI_USER_DAILY_COST_CAP_USD_CENTS
 * header comment for why (the only call site that would ever populate
 * ai_jobs.requested_by_user_id, the AI-1.4 assistant UI, is deliberately
 * deferred). Declared and unit-testable now, same "declared ahead of its
 * consumer" pattern as isAiAssistantEnabled() itself, so that future UI only
 * has to call this function, not write it.
 */
export async function checkUserDailyCostCap(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<CostCapCheckResult> {
  const { data, error } = await supabase
    .from('ai_token_ledger')
    .select('cost_usd_cents, ai_jobs!inner(requested_by_user_id)')
    .eq('ai_jobs.requested_by_user_id', userId)
    .gte('created_at', currentUtcDayStartIso());
  if (error) {
    throw new Error(`checkUserDailyCostCap: failed to read ai_token_ledger for user ${userId}: ${error.message}`);
  }

  const currentSpendCents = (data ?? []).reduce(
    (sum, row) => sum + (row as { cost_usd_cents: number }).cost_usd_cents,
    0
  );
  return evaluateCostCap(currentSpendCents, AI_USER_DAILY_COST_CAP_USD_CENTS);
}
