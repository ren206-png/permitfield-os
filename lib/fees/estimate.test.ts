import { describe, expect, it } from 'vitest';
import type { ResolvedFact } from '@/lib/requirements/rules/condition';
import { estimateFees, type FeeScheduleRecord } from './estimate';
import { exactDecimal, formatMinor, round } from './money';
import { FeeScheduleParametersSchema } from './schedule';

// Gate 6.5 exit evidence (master prompt §17 N.5): "fee tier/rounding tests
// in minor units".

const confirmed = (value: unknown, unit: string | null): ResolvedFact => ({ status: 'confirmed', factId: 'f', value, unit });
const facts = (entries: Record<string, ResolvedFact>) => new Map(Object.entries(entries));
const schedule = (parameters: unknown, over: Partial<FeeScheduleRecord> = {}): FeeScheduleRecord => ({
  id: 'fs1',
  version: 3,
  currency: 'CAD',
  roundingRule: 'half_up_to_cent',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  parameters,
  sourceOverdue: false,
  ...over,
});
const today = { asOf: '2026-10-29' };
const area = (m2: number) => ({ facts: facts({ 'project.floor_area': confirmed(m2, 'm2') }), jobValueMinor: 4_000_000, ...today });

describe('round (stored rounding rule)', () => {
  const r = (num: bigint, den: bigint) => ({ num, den });
  it('half up / half even to the cent', () => {
    expect(round(r(25n, 10n), 'half_up_to_cent')).toBe(3); // 2.5 c -> 3
    expect(round(r(25n, 10n), 'half_even_to_cent')).toBe(2); // 2.5 c -> 2 (even)
    expect(round(r(35n, 10n), 'half_even_to_cent')).toBe(4); // 3.5 c -> 4 (even)
    expect(round(r(24n, 10n), 'half_up_to_cent')).toBe(2);
  });
  it('up / down to the dollar', () => {
    expect(round(r(10001n, 1n), 'up_to_dollar')).toBe(10100);
    expect(round(r(10099n, 1n), 'down_to_dollar')).toBe(10000);
    expect(round(r(10000n, 1n), 'up_to_dollar')).toBe(10000);
  });
  it('decimals are exact, never floats: 0.1 + 0.2 style inputs stay exact', () => {
    expect(exactDecimal('118.5')).toEqual({ num: 1185n, den: 10n });
    expect(() => exactDecimal('1e3')).toThrow();
    expect(() => exactDecimal('-5')).toThrow();
  });
  it('formats without float math', () => {
    expect(formatMinor(round(r(123456789n, 1n), 'half_up_to_cent'), 'CAD')).toBe('CAD 1,234,567.89');
  });
});

describe('estimateFees', () => {
  it('rate per m2 with a minimum, flat fee, and a separate deposit', () => {
    const est = estimateFees(
      schedule({
        components: [
          { kind: 'rate', label: 'Building permit', category: 'fee', input: { source: 'fact', fact: 'project.floor_area', unit: 'm2' }, rate_minor: 1585, per: 1, min_minor: 20_000 },
          { kind: 'flat', label: 'Application fee', category: 'fee', amount_minor: 15_000 },
          { kind: 'flat', label: 'Damage deposit', category: 'deposit', amount_minor: 100_000 },
        ],
        exclusions: ['GST', 'Development charges'],
      }),
      area(118.5)
    );
    // 1585 c × 118.5 = 187,822.5 c -> 187,823 (half up)
    expect(est).toMatchObject({ status: 'estimated', currency: 'CAD', totalMinor: 187_823 + 15_000, depositsMinor: 100_000 });
    expect(est.lines.map((l) => l.amountMinor)).toEqual([187_823, 15_000, 100_000]);
    expect(est.exclusions).toEqual(['GST', 'Development charges']);
    const tiny = estimateFees(schedule({ components: [{ kind: 'rate', label: 'B', category: 'fee', input: { source: 'fact', fact: 'project.floor_area', unit: 'm2' }, rate_minor: 1585, per: 1, min_minor: 20_000 }] }), area(5));
    expect(tiny.totalMinor).toBe(20_000);
  });

  it('marginal tiers on job value, rounded half-even', () => {
    const params = {
      components: [
        {
          kind: 'tiered',
          label: 'Permit fee',
          category: 'fee',
          input: { source: 'job_value' },
          method: 'marginal',
          // $10 per $1,000 up to $100k, then $5 per $1,000 (amounts in cents)
          tiers: [
            { up_to: 10_000_000, rate_minor: 1_000, per: 100_000 },
            { up_to: null, rate_minor: 500, per: 100_000 },
          ],
        },
      ],
    };
    const est = (jobValueMinor: number) => estimateFees(schedule(params, { roundingRule: 'half_even_to_cent' }), { facts: facts({}), jobValueMinor, ...today });
    expect(est(4_000_000).totalMinor).toBe(40_000); // $40k -> $400
    expect(est(10_000_000).totalMinor).toBe(100_000); // exactly the boundary -> $1,000
    expect(est(15_000_000).totalMinor).toBe(125_000); // $1,000 + $250
    expect(est(10_000_050).totalMinor).toBe(100_000); // + 50 c × 0.5 % = 0.25 c -> rounds to 0
  });

  it('flat-per-tier picks the first tier the input falls in (inclusive bounds)', () => {
    const params = {
      components: [
        {
          kind: 'tiered',
          label: 'Electrical permit',
          category: 'fee',
          input: { source: 'fact', fact: 'electrical.service_amps', unit: 'A' },
          method: 'flat_per_tier',
          tiers: [
            { up_to: 200, amount_minor: 30_000 },
            { up_to: 400, amount_minor: 55_000 },
            { up_to: null, amount_minor: 90_000 },
          ],
        },
      ],
    };
    const amps = (a: number) =>
      estimateFees(schedule(params), { facts: facts({ 'electrical.service_amps': confirmed(a, 'A') }), jobValueMinor: null, ...today }).totalMinor;
    expect([amps(100), amps(200), amps(201), amps(400), amps(1200)]).toEqual([30_000, 30_000, 55_000, 55_000, 90_000]);
  });

  it('percentage with a maximum, rounded up to the dollar', () => {
    const est = estimateFees(
      schedule(
        { components: [{ kind: 'percent', label: 'Plan review', category: 'surcharge', input: { source: 'job_value' }, basis_points: 125, max_minor: 50_000 }] },
        { roundingRule: 'up_to_dollar' }
      ),
      { facts: facts({}), jobValueMinor: 1_234_567, ...today }
    );
    // 1.25 % of 1,234,567 c = 15,432.0875 c -> up to the dollar = 15,500
    expect(est.totalMinor).toBe(15_500);
  });

  it('no schedule is unavailable -- never zero', () => {
    const est = estimateFees(null, area(100));
    expect(est).toMatchObject({ status: 'unavailable', totalMinor: null });
  });

  it('a zero-amount schedule is a real zero, distinct from unavailable', () => {
    const est = estimateFees(schedule({ components: [{ kind: 'flat', label: 'No fee for this permit', category: 'fee', amount_minor: 0 }] }), area(1));
    expect(est).toMatchObject({ status: 'estimated', totalMinor: 0 });
  });

  it('missing, unconfirmed or wrong-unit inputs give missing_inputs and no total', () => {
    const params = { components: [{ kind: 'rate', label: 'B', category: 'fee', input: { source: 'fact', fact: 'project.floor_area', unit: 'm2' }, rate_minor: 100, per: 1 }] };
    expect(estimateFees(schedule(params), { facts: facts({}), jobValueMinor: null, ...today })).toMatchObject({ status: 'missing_inputs', totalMinor: null, missingInputs: ['project.floor_area (confirmed)'] });
    expect(estimateFees(schedule(params), { facts: facts({ 'project.floor_area': { status: 'awaiting_confirmation' } }), jobValueMinor: null, ...today }).status).toBe('missing_inputs');
    expect(estimateFees(schedule(params), { facts: facts({ 'project.floor_area': confirmed(1200, 'sq_ft') }), jobValueMinor: null, ...today })).toMatchObject({
      status: 'missing_inputs',
      missingInputs: ['project.floor_area in m2'],
    });
  });

  it('outside the effective window, or with an overdue source, is stale: lines shown, no total', () => {
    const params = { components: [{ kind: 'flat', label: 'Fee', category: 'fee', amount_minor: 100 }] };
    expect(estimateFees(schedule(params, { effectiveTo: '2026-06-30' }), area(1))).toMatchObject({ status: 'stale_schedule', totalMinor: null, lines: [{ amountMinor: 100 }] });
    expect(estimateFees(schedule(params, { sourceOverdue: true }), area(1)).status).toBe('stale_schedule');
  });

  it('authority-quoted fees give no estimate', () => {
    expect(estimateFees(schedule({ components: [{ kind: 'flat', label: 'x', category: 'fee', amount_minor: 1 }], authority_quote_required: true }), area(1))).toMatchObject({
      status: 'authority_quote_required',
      totalMinor: null,
    });
  });

  it('a malformed stored schedule is unavailable, not guessed', () => {
    expect(estimateFees(schedule({ components: [{ kind: 'rate', label: 'x', category: 'fee', rate_minor: 1.5, per: 1 }] }), area(1)).status).toBe('unavailable');
  });
});

describe('FeeScheduleParametersSchema', () => {
  it('rejects float money, inverted bounds, unordered or open-middle tiers, unknown fact keys', () => {
    const bad = [
      { components: [{ kind: 'flat', label: 'x', category: 'fee', amount_minor: 12.5 }] },
      { components: [{ kind: 'rate', label: 'x', category: 'fee', input: { source: 'job_value' }, rate_minor: 1, per: 1, min_minor: 10, max_minor: 5 }] },
      { components: [{ kind: 'tiered', label: 'x', category: 'fee', input: { source: 'job_value' }, method: 'flat_per_tier', tiers: [{ up_to: 10, amount_minor: 1 }, { up_to: 5, amount_minor: 2 }, { up_to: null, amount_minor: 3 }] }] },
      { components: [{ kind: 'tiered', label: 'x', category: 'fee', input: { source: 'job_value' }, method: 'flat_per_tier', tiers: [{ up_to: null, amount_minor: 1 }, { up_to: 5, amount_minor: 2 }] }] },
      { components: [{ kind: 'rate', label: 'x', category: 'fee', input: { source: 'fact', fact: 'project.ceiling_height', unit: 'm' }, rate_minor: 1, per: 1 }] },
      { components: [{ kind: 'flat', label: 'x', category: 'tax', amount_minor: 1 }] },
    ];
    for (const b of bad) expect(FeeScheduleParametersSchema.safeParse(b).success).toBe(false);
  });
});
