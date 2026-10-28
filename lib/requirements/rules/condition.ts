import { z } from 'zod';

// Gate 6.2: the bounded rule language for "does this requirement apply to
// this project?" (master prompt §9). A condition is plain JSON, validated by
// ConditionSchema before it is evaluated or published. There is no eval, no
// expression strings and nothing executable: a condition can only compare a
// confirmed project fact with a literal, and combine those comparisons with
// all / any / not.
//
// Evaluation is three-valued (Kleene logic): a comparison whose fact is
// missing, unconfirmed, of the wrong type or in a different unit is
// "unknown", never false -- missing data must never turn into "not required".

export const MAX_CONDITION_DEPTH = 8;
export const MAX_CONDITION_NODES = 64;

const FactKeySchema = z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/, 'fact keys are lower_snake_case, dot-separated');
const ScalarSchema = z.union([z.string().min(1).max(200), z.number().finite(), z.boolean()]);
const UnitSchema = z.string().min(1).max(32);

export type Scalar = z.infer<typeof ScalarSchema>;

export type Comparison =
  | { fact: string; op: 'eq' | 'neq'; value: Scalar }
  | { fact: string; op: 'in'; value: Scalar[] }
  | { fact: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number; unit?: string };

export type Condition = Comparison | { all: Condition[] } | { any: Condition[] } | { not: Condition };

const ComparisonSchema = z.union([
  z.strictObject({ fact: FactKeySchema, op: z.enum(['eq', 'neq']), value: ScalarSchema }),
  z.strictObject({ fact: FactKeySchema, op: z.literal('in'), value: z.array(ScalarSchema).min(1).max(50) }),
  z.strictObject({
    fact: FactKeySchema,
    op: z.enum(['gt', 'gte', 'lt', 'lte']),
    value: z.number().finite(),
    unit: UnitSchema.optional(),
  }),
]);

const ConditionShape: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    ComparisonSchema,
    z.strictObject({ all: z.array(ConditionShape).min(1) }),
    z.strictObject({ any: z.array(ConditionShape).min(1) }),
    z.strictObject({ not: ConditionShape }),
  ])
);

function measure(condition: Condition, depth = 1): { depth: number; nodes: number } {
  if ('all' in condition || 'any' in condition) {
    const children = 'all' in condition ? condition.all : condition.any;
    return children.reduce(
      (acc, child) => {
        const m = measure(child, depth + 1);
        return { depth: Math.max(acc.depth, m.depth), nodes: acc.nodes + m.nodes };
      },
      { depth, nodes: 1 }
    );
  }
  if ('not' in condition) {
    const m = measure(condition.not, depth + 1);
    return { depth: m.depth, nodes: m.nodes + 1 };
  }
  return { depth, nodes: 1 };
}

export const ConditionSchema = ConditionShape.superRefine((condition, ctx) => {
  const { depth, nodes } = measure(condition);
  if (depth > MAX_CONDITION_DEPTH) {
    ctx.addIssue({ code: 'custom', message: `condition is nested ${depth} deep (max ${MAX_CONDITION_DEPTH})` });
  }
  if (nodes > MAX_CONDITION_NODES) {
    ctx.addIssue({ code: 'custom', message: `condition has ${nodes} parts (max ${MAX_CONDITION_NODES})` });
  }
});

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type Tri = 'true' | 'false' | 'unknown';

// What the engine knows about one fact key (see facts.ts).
export type ResolvedFact =
  | { status: 'confirmed'; factId: string; value: unknown; unit: string | null }
  | { status: 'awaiting_confirmation' }
  | { status: 'missing' };

export type UnknownReason = 'missing_fact' | 'awaiting_confirmation' | 'type_mismatch' | 'unit_mismatch';

export interface ComparisonTrace {
  fact: string;
  op: Comparison['op'];
  expected: Comparison['value'];
  unit?: string;
  actual?: unknown;
  result: Tri;
  reason?: UnknownReason;
}

export interface ConditionResult {
  value: Tri;
  trace: ComparisonTrace[];
  // The confirmed fact rows the result read (project_requirement_snapshots.fact_ids).
  factIds: string[];
}

function isScalar(v: unknown): v is Scalar {
  return typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

function compare(c: Comparison, fact: ResolvedFact): Omit<ComparisonTrace, 'fact' | 'op' | 'expected' | 'unit'> {
  if (fact.status === 'missing') return { result: 'unknown', reason: 'missing_fact' };
  if (fact.status === 'awaiting_confirmation') return { result: 'unknown', reason: 'awaiting_confirmation' };
  const actual = fact.value;

  switch (c.op) {
    case 'eq':
    case 'neq': {
      if (!isScalar(actual) || typeof actual !== typeof c.value) return { actual, result: 'unknown', reason: 'type_mismatch' };
      const equal = actual === c.value;
      return { actual, result: (c.op === 'eq' ? equal : !equal) ? 'true' : 'false' };
    }
    case 'in': {
      if (!isScalar(actual)) return { actual, result: 'unknown', reason: 'type_mismatch' };
      const comparable = c.value.filter((v) => typeof v === typeof actual);
      if (comparable.length === 0) return { actual, result: 'unknown', reason: 'type_mismatch' };
      return { actual, result: comparable.includes(actual) ? 'true' : 'false' };
    }
    default: {
      if (typeof actual !== 'number' || !Number.isFinite(actual)) return { actual, result: 'unknown', reason: 'type_mismatch' };
      // No unit conversion: a different (or missing) unit is unknown, not a guess.
      if ((c.unit ?? null) !== (fact.unit ?? null)) return { actual, result: 'unknown', reason: 'unit_mismatch' };
      const holds =
        c.op === 'gt' ? actual > c.value : c.op === 'gte' ? actual >= c.value : c.op === 'lt' ? actual < c.value : actual <= c.value;
      return { actual, result: holds ? 'true' : 'false' };
    }
  }
}

export function evaluateCondition(condition: Condition, facts: ReadonlyMap<string, ResolvedFact>): ConditionResult {
  const trace: ComparisonTrace[] = [];
  const factIds = new Set<string>();

  const walk = (c: Condition): Tri => {
    if ('all' in c) {
      const results = c.all.map(walk);
      return results.includes('false') ? 'false' : results.includes('unknown') ? 'unknown' : 'true';
    }
    if ('any' in c) {
      const results = c.any.map(walk);
      return results.includes('true') ? 'true' : results.includes('unknown') ? 'unknown' : 'false';
    }
    if ('not' in c) {
      const inner = walk(c.not);
      return inner === 'unknown' ? 'unknown' : inner === 'true' ? 'false' : 'true';
    }
    const fact = facts.get(c.fact) ?? { status: 'missing' as const };
    if (fact.status === 'confirmed') factIds.add(fact.factId);
    const outcome = compare(c, fact);
    trace.push({ fact: c.fact, op: c.op, expected: c.value, ...('unit' in c && c.unit ? { unit: c.unit } : {}), ...outcome });
    return outcome.result;
  };

  const value = walk(condition);
  return { value, trace, factIds: [...factIds] };
}
