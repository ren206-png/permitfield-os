import type { ResolvedFact } from '@/lib/requirements/rules/condition';
import {
  add,
  div,
  exactDecimal,
  fromInt,
  lessOrEqual,
  maxR,
  minR,
  minor,
  mul,
  round,
  sub,
  type MinorUnits,
  type Rational,
  type RoundingRule,
} from './money';
import { FeeScheduleParametersSchema, type FeeComponent, type FeeInput } from './schedule';

// Gate 6.5: deterministic fee estimates (master prompt §16). Given one
// published fee schedule version and the project's CONFIRMED facts (plus the
// application's job value), returns itemized lines in integer minor units
// and one of five statuses:
//   unavailable               -- no schedule for this permit type: never "zero"
//   authority_quote_required  -- the authority sets the fee after review
//   stale_schedule            -- outside the schedule's effective window, or
//                                its source is overdue for a re-check
//   missing_inputs            -- a needed confirmed fact or the job value is missing
//   estimated                 -- every line computed; total given
// Only `estimated` carries a total. The other statuses still show whatever
// lines could be computed, as indicative, with the reason.

export const FEE_ENGINE_VERSION = 'fees-v1';

export interface FeeScheduleRecord {
  id: string;
  version: number;
  currency: string;
  roundingRule: RoundingRule;
  effectiveFrom: string;
  effectiveTo: string | null;
  parameters: unknown;
  sourceOverdue: boolean;
}

export interface FeeInputs {
  facts: ReadonlyMap<string, ResolvedFact>;
  jobValueMinor: number | null;
  asOf: string; // YYYY-MM-DD
}

export interface FeeLine {
  label: string;
  category: 'fee' | 'deposit' | 'surcharge';
  amountMinor: MinorUnits;
  calculation: string;
}

export type FeeStatus = 'estimated' | 'missing_inputs' | 'stale_schedule' | 'authority_quote_required' | 'unavailable';

export interface FeeEstimate {
  status: FeeStatus;
  scheduleId: string | null;
  scheduleVersion: number | null;
  currency: string | null;
  // fee + surcharge lines; deposits are reported separately.
  totalMinor: MinorUnits | null;
  depositsMinor: MinorUnits | null;
  lines: FeeLine[];
  missingInputs: string[];
  exclusions: string[];
  assumptions: string[];
  reasons: string[];
}

const empty = (status: FeeStatus, reasons: string[]): FeeEstimate => ({
  status,
  scheduleId: null,
  scheduleVersion: null,
  currency: null,
  totalMinor: null,
  depositsMinor: null,
  lines: [],
  missingInputs: [],
  exclusions: [],
  assumptions: [],
  reasons,
});

type Quantity = { ok: true; value: Rational; text: string } | { ok: false; missing: string };

function quantityOf(input: FeeInput, inputs: FeeInputs): Quantity {
  if (input.source === 'job_value') {
    if (inputs.jobValueMinor === null || !Number.isSafeInteger(inputs.jobValueMinor) || inputs.jobValueMinor < 0) {
      return { ok: false, missing: 'estimated job value' };
    }
    return { ok: true, value: fromInt(inputs.jobValueMinor), text: `job value ${inputs.jobValueMinor} cents` };
  }
  const fact = inputs.facts.get(input.fact);
  if (!fact || fact.status !== 'confirmed') return { ok: false, missing: `${input.fact} (confirmed)` };
  if (fact.unit !== input.unit) return { ok: false, missing: `${input.fact} in ${input.unit}` };
  if (typeof fact.value !== 'number' || !Number.isFinite(fact.value) || fact.value < 0) return { ok: false, missing: `${input.fact} as a number` };
  try {
    return { ok: true, value: exactDecimal(fact.value), text: `${fact.value} ${input.unit}` };
  } catch {
    return { ok: false, missing: `${input.fact} with at most 6 decimals` };
  }
}

function clamp(amount: Rational, c: { min_minor?: number; max_minor?: number }): Rational {
  let result = amount;
  if (c.min_minor !== undefined) result = maxR(result, fromInt(c.min_minor));
  if (c.max_minor !== undefined) result = minR(result, fromInt(c.max_minor));
  return result;
}

function exactComponent(c: FeeComponent, inputs: FeeInputs): { ok: true; amount: Rational; calculation: string } | { ok: false; missing: string } {
  if (c.kind === 'flat') return { ok: true, amount: fromInt(c.amount_minor), calculation: 'flat amount' };
  const q = quantityOf(c.input, inputs);
  if (!q.ok) return q;

  if (c.kind === 'rate') {
    const raw = div(mul(fromInt(c.rate_minor), q.value), exactDecimal(c.per));
    return { ok: true, amount: clamp(raw, c), calculation: `${c.rate_minor} cents per ${c.per} × ${q.text}` };
  }
  if (c.kind === 'percent') {
    const raw = div(mul(q.value, fromInt(c.basis_points)), fromInt(10_000));
    return { ok: true, amount: clamp(raw, c), calculation: `${c.basis_points / 100} % of ${q.text}` };
  }
  // tiered
  if (c.method === 'flat_per_tier') {
    const tier = c.tiers.find((t) => t.up_to === null || lessOrEqual(q.value, exactDecimal(t.up_to)));
    // Validation guarantees an open last tier, so a tier always matches.
    return { ok: true, amount: clamp(fromInt(tier!.amount_minor!), c), calculation: `tier up to ${tier!.up_to ?? 'any'} for ${q.text}` };
  }
  let total = fromInt(0);
  let lower = fromInt(0);
  for (const t of c.tiers) {
    const upper = t.up_to === null ? q.value : minR(exactDecimal(t.up_to), q.value);
    if (lessOrEqual(upper, lower)) break;
    const slice = sub(upper, lower);
    total = add(total, div(mul(fromInt(t.rate_minor!), slice), exactDecimal(t.per!)));
    lower = upper;
    if (t.up_to === null || lessOrEqual(q.value, exactDecimal(t.up_to))) break;
  }
  return { ok: true, amount: clamp(total, c), calculation: `marginal tiers on ${q.text}` };
}

export function estimateFees(schedule: FeeScheduleRecord | null, inputs: FeeInputs): FeeEstimate {
  if (!schedule) return empty('unavailable', ['No published fee schedule for this permit type. That is not the same as no fee.']);

  const parsed = FeeScheduleParametersSchema.safeParse(schedule.parameters);
  if (!parsed.success) return empty('unavailable', ['The published fee schedule is not in a usable form.']);
  const params = parsed.data;

  const base: FeeEstimate = {
    ...empty('estimated', []),
    scheduleId: schedule.id,
    scheduleVersion: schedule.version,
    currency: schedule.currency,
    exclusions: params.exclusions,
    assumptions: params.assumptions,
  };

  if (params.authority_quote_required) {
    return { ...base, status: 'authority_quote_required', reasons: ['The authority sets this fee after reviewing the application.'] };
  }

  const reasons: string[] = [];
  let stale = false;
  if (inputs.asOf < schedule.effectiveFrom || (schedule.effectiveTo !== null && inputs.asOf > schedule.effectiveTo)) {
    stale = true;
    reasons.push(`The schedule is effective ${schedule.effectiveFrom} to ${schedule.effectiveTo ?? 'open'}, not on ${inputs.asOf}.`);
  }
  if (schedule.sourceOverdue) {
    stale = true;
    reasons.push('The official source behind this schedule is overdue for a re-check.');
  }

  const missing: string[] = [];
  for (const c of params.components) {
    const result = exactComponent(c, inputs);
    if (!result.ok) {
      missing.push(result.missing);
      continue;
    }
    base.lines.push({ label: c.label, category: c.category, amountMinor: round(result.amount, schedule.roundingRule), calculation: result.calculation });
  }

  const sum = (category: (cat: FeeLine['category']) => boolean) => {
    const total = base.lines.filter((l) => category(l.category)).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('fee total too large');
    return minor(Number(total));
  };

  if (missing.length > 0) {
    return { ...base, status: 'missing_inputs', missingInputs: [...new Set(missing)], reasons: [...reasons, 'Some inputs are missing, so there is no total.'] };
  }
  if (stale) return { ...base, status: 'stale_schedule', reasons };
  return { ...base, status: 'estimated', totalMinor: sum((c) => c !== 'deposit'), depositsMinor: sum((c) => c === 'deposit'), reasons };
}
