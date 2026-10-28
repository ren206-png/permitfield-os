import { z } from 'zod';
import { ConditionSchema, evaluateCondition, type ComparisonTrace, type ResolvedFact } from './condition';

// Gate 6.2: validates and evaluates a published rule set
// (rule_set_versions + rule_set_version_items, 20260806000091).
//
// Each item's requirement_snapshot carries the requirement as published plus
// its applicability:
//   - condition null and applies_when_text null -> always applies
//   - condition null but applies_when_text set  -> the source makes it
//     conditional and nobody has encoded the condition yet -> "unknown"
//   - condition set                              -> evaluated against facts
// "not_applicable" is only ever produced by an evaluated condition in a
// published, valid rule set (master prompt §9; the snapshot table's CHECK
// enforces the rule-set half of that).

export const ENGINE_VERSION = 'rules-v1';

export const RuleSetItemSnapshotSchema = z.strictObject({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  applies_when_text: z.string().nullable().optional(),
  condition: ConditionSchema.nullable(),
  // Prerequisite requirements (permit_requirements ids) in the same set.
  // z.guid(), not z.uuid(): catalogue ids such as
  // 00000000-0000-0000-0003-000000000001 are valid Postgres uuids but not
  // RFC 9562 variants, and z.uuid() rejects them.
  requires: z.array(z.guid()).default([]),
});

export type RuleSetItemSnapshot = z.infer<typeof RuleSetItemSnapshotSchema>;

export interface RuleSetItemInput {
  permitRequirementId: string;
  snapshot: unknown; // raw jsonb; validated here, never trusted
}

export type RuleSetProblem =
  | { kind: 'invalid_snapshot'; permitRequirementId: string; message: string }
  | { kind: 'duplicate_requirement'; permitRequirementId: string }
  | { kind: 'unknown_prerequisite'; permitRequirementId: string; prerequisiteId: string }
  | { kind: 'dependency_cycle'; cycle: string[] };

export interface ValidatedRuleSet {
  items: Map<string, RuleSetItemSnapshot>;
  problems: RuleSetProblem[];
}

export function validateRuleSet(inputs: readonly RuleSetItemInput[]): ValidatedRuleSet {
  const items = new Map<string, RuleSetItemSnapshot>();
  const problems: RuleSetProblem[] = [];

  for (const input of inputs) {
    if (items.has(input.permitRequirementId)) {
      problems.push({ kind: 'duplicate_requirement', permitRequirementId: input.permitRequirementId });
      continue;
    }
    const parsed = RuleSetItemSnapshotSchema.safeParse(input.snapshot);
    if (!parsed.success) {
      problems.push({
        kind: 'invalid_snapshot',
        permitRequirementId: input.permitRequirementId,
        message: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      });
      continue;
    }
    items.set(input.permitRequirementId, parsed.data);
  }

  for (const [id, item] of items) {
    for (const prerequisiteId of item.requires) {
      if (!items.has(prerequisiteId)) problems.push({ kind: 'unknown_prerequisite', permitRequirementId: id, prerequisiteId });
    }
  }

  problems.push(...findCycles(items));
  return { items, problems };
}

// Depth-first search over prerequisite edges; reports each cycle once, as the
// path that closes it (e.g. [a, b, a]).
function findCycles(items: ReadonlyMap<string, RuleSetItemSnapshot>): RuleSetProblem[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: RuleSetProblem[] = [];
  const seen = new Set<string>();

  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycle = [...path.slice(path.indexOf(id)), id];
      const key = [...cycle.slice(0, -1)].sort().join('>');
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push({ kind: 'dependency_cycle', cycle });
      }
      return;
    }
    state.set(id, 'visiting');
    for (const next of items.get(id)?.requires ?? []) {
      if (items.has(next)) visit(next, [...path, id]);
    }
    state.set(id, 'done');
  };

  for (const id of [...items.keys()].sort()) visit(id, []);
  return cycles;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type Applicability = 'applicable' | 'not_applicable' | 'unknown';

export type OutcomeReason =
  | 'always_required'
  | 'condition_met'
  | 'condition_not_met'
  | 'condition_unknown'
  | 'condition_not_encoded'
  | 'not_in_rule_set'
  | 'no_published_rule_set'
  | 'rule_set_invalid';

export interface RequirementOutcome {
  permitRequirementId: string;
  outcome: Applicability;
  reason: OutcomeReason;
  trace: ComparisonTrace[];
  factIds: string[];
  prerequisites: string[];
  warnings: string[];
}

export type RuleSetEvaluation =
  | { coverage: 'published_rule_set'; ruleSetVersionId: string; outcomes: RequirementOutcome[] }
  | { coverage: 'no_published_rule_set' | 'rule_set_invalid'; ruleSetVersionId: string | null; outcomes: RequirementOutcome[]; problems?: RuleSetProblem[] };

const unknownFor = (permitRequirementId: string, reason: OutcomeReason): RequirementOutcome => ({
  permitRequirementId,
  outcome: 'unknown',
  reason,
  trace: [],
  factIds: [],
  prerequisites: [],
  warnings: [],
});

export function evaluateRuleSet(input: {
  ruleSet: { id: string; items: readonly RuleSetItemInput[] } | null;
  // The live catalogue for this jurisdiction + permit type, so that with no
  // usable rule set every requirement is still reported, as unknown.
  catalogRequirementIds: readonly string[];
  facts: ReadonlyMap<string, ResolvedFact>;
}): RuleSetEvaluation {
  if (!input.ruleSet) {
    return {
      coverage: 'no_published_rule_set',
      ruleSetVersionId: null,
      outcomes: input.catalogRequirementIds.map((id) => unknownFor(id, 'no_published_rule_set')),
    };
  }

  const { items, problems } = validateRuleSet(input.ruleSet.items);
  if (problems.length > 0) {
    // An inconsistent published set is not evaluated at all.
    const ids = [...new Set([...input.ruleSet.items.map((i) => i.permitRequirementId), ...input.catalogRequirementIds])];
    return {
      coverage: 'rule_set_invalid',
      ruleSetVersionId: input.ruleSet.id,
      outcomes: ids.map((id) => unknownFor(id, 'rule_set_invalid')),
      problems,
    };
  }

  const outcomes: RequirementOutcome[] = [];
  for (const [id, item] of items) {
    const base = { permitRequirementId: id, prerequisites: item.requires, warnings: [] as string[] };
    if (item.condition === null) {
      outcomes.push(
        item.applies_when_text
          ? { ...base, outcome: 'unknown', reason: 'condition_not_encoded', trace: [], factIds: [] }
          : { ...base, outcome: 'applicable', reason: 'always_required', trace: [], factIds: [] }
      );
      continue;
    }
    const result = evaluateCondition(item.condition, input.facts);
    outcomes.push({
      ...base,
      outcome: result.value === 'true' ? 'applicable' : result.value === 'false' ? 'not_applicable' : 'unknown',
      reason: result.value === 'true' ? 'condition_met' : result.value === 'false' ? 'condition_not_met' : 'condition_unknown',
      trace: result.trace,
      factIds: result.factIds,
    });
  }

  // A live catalogue requirement the published set doesn't cover is reported
  // as unknown -- "no matching rule" never means "not required" (§3.3).
  for (const id of input.catalogRequirementIds) {
    if (!items.has(id)) outcomes.push(unknownFor(id, 'not_in_rule_set'));
  }

  // A requirement that applies but depends on one that does not is flagged
  // for review rather than resolved automatically (no invented precedence).
  const byId = new Map(outcomes.map((o) => [o.permitRequirementId, o]));
  for (const o of outcomes) {
    if (o.outcome !== 'applicable') continue;
    for (const p of o.prerequisites) {
      if (byId.get(p)?.outcome === 'not_applicable') o.warnings.push(`prerequisite_not_applicable:${p}`);
    }
  }

  return { coverage: 'published_rule_set', ruleSetVersionId: input.ruleSet.id, outcomes };
}

// ---------------------------------------------------------------------------
// Readiness summary
// ---------------------------------------------------------------------------

export interface ApplicabilitySummary {
  coverage: RuleSetEvaluation['coverage'];
  // Every count below is out of `total` requirements in the evaluation.
  total: number;
  applicable: number;
  notApplicable: number;
  unknown: number;
  unknownBecause: Partial<Record<OutcomeReason | 'missing_fact' | 'awaiting_confirmation' | 'type_mismatch' | 'unit_mismatch', number>>;
  withWarnings: number;
}

export function summarizeEvaluation(evaluation: RuleSetEvaluation): ApplicabilitySummary {
  const summary: ApplicabilitySummary = {
    coverage: evaluation.coverage,
    total: evaluation.outcomes.length,
    applicable: 0,
    notApplicable: 0,
    unknown: 0,
    unknownBecause: {},
    withWarnings: 0,
  };
  for (const o of evaluation.outcomes) {
    if (o.warnings.length > 0) summary.withWarnings += 1;
    if (o.outcome === 'applicable') summary.applicable += 1;
    else if (o.outcome === 'not_applicable') summary.notApplicable += 1;
    else {
      summary.unknown += 1;
      const reasons = o.reason === 'condition_unknown' ? [...new Set(o.trace.map((t) => t.reason).filter(Boolean))] : [o.reason];
      for (const r of reasons as (keyof ApplicabilitySummary['unknownBecause'])[]) {
        summary.unknownBecause[r] = (summary.unknownBecause[r] ?? 0) + 1;
      }
    }
  }
  return summary;
}
