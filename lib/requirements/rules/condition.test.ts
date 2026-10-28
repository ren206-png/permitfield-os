import { describe, expect, it } from 'vitest';
import { ConditionSchema, evaluateCondition, MAX_CONDITION_DEPTH, type Condition, type ResolvedFact } from './condition';

const confirmed = (factId: string, value: unknown, unit: string | null = null): ResolvedFact => ({
  status: 'confirmed',
  factId,
  value,
  unit,
});
const facts = (entries: Record<string, ResolvedFact>) => new Map(Object.entries(entries));

describe('ConditionSchema', () => {
  it('accepts comparisons and all/any/not combinations', () => {
    const c = {
      all: [
        { fact: 'building.strata_titled', op: 'eq', value: true },
        { any: [{ fact: 'project.floor_area', op: 'gte', value: 100, unit: 'm2' }, { not: { fact: 'use.group', op: 'in', value: ['D', 'E'] } }] },
      ],
    };
    expect(ConditionSchema.safeParse(c).success).toBe(true);
  });

  it('rejects anything executable or loose: unknown ops, extra keys, bad fact keys, empty lists', () => {
    for (const bad of [
      { fact: 'x', op: 'matches', value: '.*' },
      { fact: 'x', op: 'eq', value: 1, code: 'process.exit()' },
      { fact: 'Not Snake', op: 'eq', value: 1 },
      { fact: 'x', op: 'in', value: [] },
      { all: [] },
      { fact: 'x', op: 'gt', value: '5' },
      'fact == 1',
    ]) {
      expect(ConditionSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('bounds nesting depth', () => {
    let c: Condition = { fact: 'x', op: 'eq', value: 1 };
    for (let i = 0; i < MAX_CONDITION_DEPTH; i++) c = { not: c };
    const result = ConditionSchema.safeParse(c);
    expect(result.success).toBe(false);
  });
});

describe('evaluateCondition: three-valued, unknown never becomes false', () => {
  const strata: Condition = { fact: 'building.strata_titled', op: 'eq', value: true };

  it('true / false from a confirmed fact, recording the fact id used', () => {
    expect(evaluateCondition(strata, facts({ 'building.strata_titled': confirmed('f1', true) }))).toMatchObject({
      value: 'true',
      factIds: ['f1'],
    });
    expect(evaluateCondition(strata, facts({ 'building.strata_titled': confirmed('f1', false) })).value).toBe('false');
  });

  it('missing, unconfirmed, wrong-type and wrong-unit facts are unknown, with the reason', () => {
    expect(evaluateCondition(strata, facts({})).trace[0]).toMatchObject({ result: 'unknown', reason: 'missing_fact' });
    expect(
      evaluateCondition(strata, facts({ 'building.strata_titled': { status: 'awaiting_confirmation' } })).trace[0]
    ).toMatchObject({ result: 'unknown', reason: 'awaiting_confirmation' });
    expect(evaluateCondition(strata, facts({ 'building.strata_titled': confirmed('f1', 'yes') })).trace[0]).toMatchObject({
      result: 'unknown',
      reason: 'type_mismatch',
    });
    const area: Condition = { fact: 'project.floor_area', op: 'gte', value: 100, unit: 'm2' };
    expect(evaluateCondition(area, facts({ 'project.floor_area': confirmed('f2', 1195, 'sq_ft') })).trace[0]).toMatchObject({
      result: 'unknown',
      reason: 'unit_mismatch',
    });
    expect(evaluateCondition(area, facts({ 'project.floor_area': confirmed('f2', 111, 'm2') })).value).toBe('true');
  });

  it('not(unknown) stays unknown', () => {
    expect(evaluateCondition({ not: strata }, facts({})).value).toBe('unknown');
  });

  it('Kleene all/any: a definite answer wins only when the unknown part cannot change it', () => {
    const known = { 'a.flag': confirmed('fa', true) };
    const a: Condition = { fact: 'a.flag', op: 'eq', value: true };
    const b: Condition = { fact: 'b.flag', op: 'eq', value: true }; // missing
    const notA: Condition = { fact: 'a.flag', op: 'eq', value: false };

    expect(evaluateCondition({ all: [a, b] }, facts(known)).value).toBe('unknown');
    expect(evaluateCondition({ all: [notA, b] }, facts(known)).value).toBe('false');
    expect(evaluateCondition({ any: [a, b] }, facts(known)).value).toBe('true');
    expect(evaluateCondition({ any: [notA, b] }, facts(known)).value).toBe('unknown');
  });

  it('membership compares like with like', () => {
    const group: Condition = { fact: 'use.group', op: 'in', value: ['D', 'E'] };
    expect(evaluateCondition(group, facts({ 'use.group': confirmed('g', 'E') })).value).toBe('true');
    expect(evaluateCondition(group, facts({ 'use.group': confirmed('g', 'A2') })).value).toBe('false');
    expect(evaluateCondition(group, facts({ 'use.group': confirmed('g', 3) })).value).toBe('unknown');
  });
});
