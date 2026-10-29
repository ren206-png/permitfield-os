import { z } from 'zod';
import { FACT_KEYS } from '@/lib/requirements/rules/fact-keys';

// Gate 6.5: the shape of fee_schedule_versions.parameters (migration
// 20260806000091), validated before publication and again before every
// estimate. A schedule lists components; each is a flat amount, a rate on
// one input, a tier table on one input, or a percentage of the job value.
// Amounts and rates are integer minor units (cents); quantities can be
// decimal. Deposits and surcharges are their own categories so they are
// never folded into "the fee". Taxes are not modelled: a schedule says in
// `exclusions` whatever it does not cover (§16: no invented tax treatment).
//
// Inputs come from confirmed project facts (a known fact key with its unit)
// or the application's own estimated job value (in minor units).

const Money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Positive = z.number().positive().max(1e12);
const Label = z.string().trim().min(1).max(200);
const Category = z.enum(['fee', 'deposit', 'surcharge']);

const factKeys = Object.keys(FACT_KEYS) as [string, ...string[]];
export const FeeInputSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('fact'), fact: z.enum(factKeys), unit: z.string().min(1).max(32) }),
  // Job value in minor units (cents), from permit_applications.
  z.strictObject({ source: z.literal('job_value') }),
]);

const Bounds = { min_minor: Money.optional(), max_minor: Money.optional() };

export const FeeComponentSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('flat'), label: Label, category: Category, amount_minor: Money }),
    z.strictObject({
      kind: z.literal('rate'),
      label: Label,
      category: Category,
      input: FeeInputSchema,
      rate_minor: Money,
      // The rate is charged per this many units of the input.
      per: Positive,
      ...Bounds,
    }),
    z.strictObject({
      kind: z.literal('tiered'),
      label: Label,
      category: Category,
      input: FeeInputSchema,
      // flat_per_tier: the amount of the first tier the input falls in.
      // marginal: each slice of the input is charged at its own tier's rate.
      method: z.enum(['flat_per_tier', 'marginal']),
      tiers: z
        .array(
          z.strictObject({
            // Upper bound of the tier (inclusive); null = no upper bound.
            up_to: Positive.nullable(),
            amount_minor: Money.optional(),
            rate_minor: Money.optional(),
            per: Positive.optional(),
          })
        )
        .min(1)
        .max(50),
      ...Bounds,
    }),
    z.strictObject({
      kind: z.literal('percent'),
      label: Label,
      category: Category,
      input: z.strictObject({ source: z.literal('job_value') }),
      // Hundredths of a percent: 125 = 1.25 %.
      basis_points: z.number().int().positive().max(100_000),
      ...Bounds,
    }),
  ])
  .superRefine((c, ctx) => {
    if ('min_minor' in c && 'max_minor' in c && c.min_minor !== undefined && c.max_minor !== undefined && c.min_minor > c.max_minor) {
      ctx.addIssue({ code: 'custom', message: `${c.label}: minimum is above maximum` });
    }
    if (c.kind !== 'tiered') return;
    c.tiers.forEach((t, i) => {
      const last = i === c.tiers.length - 1;
      if ((t.up_to === null) !== last) ctx.addIssue({ code: 'custom', message: `${c.label}: only the last tier has no upper bound, and it must` });
      if (i > 0 && t.up_to !== null && c.tiers[i - 1].up_to !== null && t.up_to <= (c.tiers[i - 1].up_to as number)) {
        ctx.addIssue({ code: 'custom', message: `${c.label}: tier bounds must increase` });
      }
      if (c.method === 'flat_per_tier' && t.amount_minor === undefined) ctx.addIssue({ code: 'custom', message: `${c.label}: each tier needs amount_minor` });
      if (c.method === 'marginal' && (t.rate_minor === undefined || t.per === undefined)) {
        ctx.addIssue({ code: 'custom', message: `${c.label}: each tier needs rate_minor and per` });
      }
    });
  });

export const FeeScheduleParametersSchema = z.strictObject({
  components: z.array(FeeComponentSchema).min(1).max(30),
  // The authority states the fee only after review: no estimate is given.
  authority_quote_required: z.boolean().default(false),
  exclusions: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

export type FeeComponent = z.infer<typeof FeeComponentSchema>;
export type FeeScheduleParameters = z.infer<typeof FeeScheduleParametersSchema>;
export type FeeInput = z.infer<typeof FeeInputSchema>;
