import { describe, expect, it } from 'vitest';
import type { ResolvedFact } from './condition';
import { evaluateRuleSet, summarizeEvaluation, validateRuleSet, type RuleSetItemInput } from './rule-set';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';

const item = (id: string, snapshot: Record<string, unknown>): RuleSetItemInput => ({
  permitRequirementId: id,
  snapshot: { title: `Requirement ${id.slice(-1)}`, condition: null, ...snapshot },
});
const strataCondition = { fact: 'building.strata_titled', op: 'eq', value: true };
const confirmed = (value: unknown): ResolvedFact => ({ status: 'confirmed', factId: 'f-strata', value, unit: null });
const noFacts = new Map<string, ResolvedFact>();

describe('validateRuleSet', () => {
  it('detects dependency cycles, including longer ones, and reports each once', () => {
    const { problems } = validateRuleSet([
      item(A, { requires: [B] }),
      item(B, { requires: [C] }),
      item(C, { requires: [A] }),
      item(D, { requires: [D] }),
    ]);
    const cycles = problems.filter((p) => p.kind === 'dependency_cycle');
    expect(cycles).toHaveLength(2);
    expect(cycles).toContainEqual({ kind: 'dependency_cycle', cycle: [A, B, C, A] });
    expect(cycles).toContainEqual({ kind: 'dependency_cycle', cycle: [D, D] });
  });

  it('accepts catalogue-style ids that are valid uuids but not RFC variants', () => {
    const catalogueId = '00000000-0000-0000-0003-000000000001';
    expect(validateRuleSet([item(catalogueId, {}), item(A, { requires: [catalogueId] })]).problems).toEqual([]);
  });

  it('accepts an acyclic prerequisite chain', () => {
    expect(validateRuleSet([item(A, { requires: [B] }), item(B, { requires: [C] }), item(C, {})]).problems).toEqual([]);
  });

  it('flags unknown prerequisites, duplicates and invalid snapshots (no eval, strict keys)', () => {
    const { problems } = validateRuleSet([
      item(A, { requires: [D] }),
      item(A, {}),
      item(B, { condition: 'building.strata_titled == true' }),
      item(C, { condition: null, script: 'x' }),
    ]);
    expect(problems.map((p) => p.kind).sort()).toEqual(['duplicate_requirement', 'invalid_snapshot', 'invalid_snapshot', 'unknown_prerequisite']);
  });
});

describe('evaluateRuleSet', () => {
  it('with no published rule set, every catalogue requirement is unknown -- never not_applicable', () => {
    const evaluation = evaluateRuleSet({ ruleSet: null, catalogRequirementIds: [A, B], facts: noFacts });
    expect(evaluation.coverage).toBe('no_published_rule_set');
    expect(evaluation.outcomes.map((o) => [o.outcome, o.reason])).toEqual([
      ['unknown', 'no_published_rule_set'],
      ['unknown', 'no_published_rule_set'],
    ]);
  });

  it('an invalid (e.g. cyclic) published set is not evaluated: all unknown, problems returned', () => {
    const evaluation = evaluateRuleSet({
      ruleSet: { id: 'rs1', items: [item(A, { requires: [B] }), item(B, { requires: [A] })] },
      catalogRequirementIds: [A, B],
      facts: noFacts,
    });
    expect(evaluation.coverage).toBe('rule_set_invalid');
    expect(evaluation.outcomes.every((o) => o.outcome === 'unknown' && o.reason === 'rule_set_invalid')).toBe(true);
  });

  it('always-required, encoded-conditional and unencoded-conditional items', () => {
    const ruleSet = {
      id: 'rs1',
      items: [
        item(A, {}),
        item(B, { applies_when_text: 'May be required if the building is strata titled.', condition: strataCondition }),
        item(C, { applies_when_text: 'Required for each discipline with changes in scope.', condition: null }),
      ],
    };
    const yes = evaluateRuleSet({ ruleSet, catalogRequirementIds: [A, B, C], facts: new Map([['building.strata_titled', confirmed(true)]]) });
    expect(yes.outcomes.map((o) => [o.permitRequirementId, o.outcome, o.reason])).toEqual([
      [A, 'applicable', 'always_required'],
      [B, 'applicable', 'condition_met'],
      [C, 'unknown', 'condition_not_encoded'],
    ]);
    expect(yes.outcomes[1].factIds).toEqual(['f-strata']);

    const no = evaluateRuleSet({ ruleSet, catalogRequirementIds: [A, B, C], facts: new Map([['building.strata_titled', confirmed(false)]]) });
    expect(no.outcomes[1]).toMatchObject({ outcome: 'not_applicable', reason: 'condition_not_met' });
  });

  it('a missing fact propagates as unknown, never not_applicable', () => {
    const evaluation = evaluateRuleSet({
      ruleSet: { id: 'rs1', items: [item(B, { condition: { not: strataCondition } })] },
      catalogRequirementIds: [B],
      facts: noFacts,
    });
    expect(evaluation.outcomes[0]).toMatchObject({ outcome: 'unknown', reason: 'condition_unknown' });
    expect(evaluation.outcomes[0].trace[0]).toMatchObject({ reason: 'missing_fact' });
  });

  it('not_applicable only ever comes from an evaluated condition in a valid published set', () => {
    const scenarios = [
      evaluateRuleSet({ ruleSet: null, catalogRequirementIds: [A], facts: noFacts }),
      evaluateRuleSet({ ruleSet: { id: 'rs', items: [item(A, { requires: [A] })] }, catalogRequirementIds: [A], facts: noFacts }),
      evaluateRuleSet({ ruleSet: { id: 'rs', items: [item(A, { condition: strataCondition })] }, catalogRequirementIds: [A, B], facts: noFacts }),
      evaluateRuleSet({
        ruleSet: { id: 'rs', items: [item(A, { condition: strataCondition })] },
        catalogRequirementIds: [A],
        facts: new Map([['building.strata_titled', confirmed(false)]]),
      }),
    ];
    for (const evaluation of scenarios) {
      for (const o of evaluation.outcomes) {
        if (o.outcome === 'not_applicable') {
          expect(evaluation.coverage).toBe('published_rule_set');
          expect(o.reason).toBe('condition_not_met');
        }
      }
    }
    expect(scenarios[3].outcomes[0].outcome).toBe('not_applicable');
  });

  it('a catalogue requirement missing from the published set is unknown (no match is not "not required")', () => {
    const evaluation = evaluateRuleSet({ ruleSet: { id: 'rs', items: [item(A, {})] }, catalogRequirementIds: [A, B], facts: noFacts });
    expect(evaluation.outcomes.find((o) => o.permitRequirementId === B)).toMatchObject({ outcome: 'unknown', reason: 'not_in_rule_set' });
  });

  it('an applicable requirement whose prerequisite does not apply is flagged, not resolved', () => {
    const evaluation = evaluateRuleSet({
      ruleSet: { id: 'rs', items: [item(A, { requires: [B] }), item(B, { condition: strataCondition })] },
      catalogRequirementIds: [A, B],
      facts: new Map([['building.strata_titled', confirmed(false)]]),
    });
    expect(evaluation.outcomes.find((o) => o.permitRequirementId === A)).toMatchObject({
      outcome: 'applicable',
      warnings: [`prerequisite_not_applicable:${B}`],
    });
  });
});

describe('summarizeEvaluation', () => {
  it('counts out of the full total and explains the unknowns', () => {
    const evaluation = evaluateRuleSet({
      ruleSet: {
        id: 'rs',
        items: [item(A, {}), item(B, { condition: strataCondition }), item(C, { applies_when_text: 'If required.', condition: null })],
      },
      catalogRequirementIds: [A, B, C, D],
      facts: noFacts,
    });
    expect(summarizeEvaluation(evaluation)).toEqual({
      coverage: 'published_rule_set',
      total: 4,
      applicable: 1,
      notApplicable: 0,
      unknown: 3,
      unknownBecause: { missing_fact: 1, condition_not_encoded: 1, not_in_rule_set: 1 },
      withWarnings: 0,
    });
  });
});
