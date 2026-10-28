import { ConditionSchema, type Condition } from '@/lib/requirements/rules/condition';
import { validateRuleSet, type RuleSetProblem } from '@/lib/requirements/rules/rule-set';

// Gate 6.3: turns the admin's rule-set form into publish_rule_set_version
// items (migration 20260806000094), and diffs a proposed set against the
// current published version. The database builds each snapshot from the
// live requirement row; this module validates what only the admin supplies
// -- the condition JSON -- and runs the 6.2 rule-set validation over the
// would-be snapshots first, so an invalid set is refused here instead of
// being published and then evaluating to "unknown" everywhere.

export interface LiveRequirement {
  id: string;
  title: string;
  description: string | null;
  appliesWhen: string | null;
}

export interface RuleSetFormEntry {
  requirementId: string;
  include: boolean;
  conditionJson: string;
}

export interface PublishItem {
  permit_requirement_id: string;
  condition: Condition | null;
  requires: string[];
}

export type BuildItemsResult =
  | { ok: true; items: PublishItem[] }
  | { ok: false; errors: { requirementId: string | null; message: string }[]; problems?: RuleSetProblem[] };

export function buildPublishItems(requirements: readonly LiveRequirement[], entries: readonly RuleSetFormEntry[]): BuildItemsResult {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const errors: { requirementId: string | null; message: string }[] = [];
  const items: PublishItem[] = [];

  for (const entry of entries) {
    if (!entry.include) continue;
    if (!byId.has(entry.requirementId)) {
      errors.push({ requirementId: entry.requirementId, message: 'Not a verified, current requirement of this permit type.' });
      continue;
    }
    const raw = entry.conditionJson.trim();
    if (!raw) {
      items.push({ permit_requirement_id: entry.requirementId, condition: null, requires: [] });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      errors.push({ requirementId: entry.requirementId, message: 'Condition is not valid JSON.' });
      continue;
    }
    const parsed = ConditionSchema.safeParse(json);
    if (!parsed.success) {
      errors.push({
        requirementId: entry.requirementId,
        message: `Condition is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
      });
      continue;
    }
    items.push({ permit_requirement_id: entry.requirementId, condition: parsed.data, requires: [] });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (items.length === 0) return { ok: false, errors: [{ requirementId: null, message: 'Include at least one requirement.' }] };

  const { problems } = validateRuleSet(
    items.map((item) => {
      const r = byId.get(item.permit_requirement_id)!;
      return {
        permitRequirementId: item.permit_requirement_id,
        snapshot: { title: r.title, description: r.description, applies_when_text: r.appliesWhen, condition: item.condition, requires: item.requires },
      };
    })
  );
  if (problems.length > 0) {
    return { ok: false, errors: [{ requirementId: null, message: 'The rule set is not consistent.' }], problems };
  }
  return { ok: true, items };
}

// ---------------------------------------------------------------------------
// Diff against the current published version
// ---------------------------------------------------------------------------

export interface SnapshotLike {
  title: string;
  description?: string | null;
  applies_when_text?: string | null;
  condition?: unknown;
}

export type RuleSetChange =
  | { kind: 'added'; requirementId: string; title: string }
  | { kind: 'removed'; requirementId: string; title: string }
  | { kind: 'changed'; requirementId: string; title: string; fields: ('title' | 'description' | 'applies_when' | 'condition')[] };

const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);

// Key-order-independent: jsonb read back from Postgres does not keep the
// key order it was written with.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const same = (a: unknown, b: unknown) => stableStringify(norm(a)) === stableStringify(norm(b));

export function diffRuleSet(current: ReadonlyMap<string, SnapshotLike>, next: ReadonlyMap<string, SnapshotLike>): RuleSetChange[] {
  const changes: RuleSetChange[] = [];
  for (const [id, n] of next) {
    const c = current.get(id);
    if (!c) {
      changes.push({ kind: 'added', requirementId: id, title: n.title });
      continue;
    }
    const fields: ('title' | 'description' | 'applies_when' | 'condition')[] = [];
    if (!same(c.title, n.title)) fields.push('title');
    if (!same(c.description, n.description)) fields.push('description');
    if (!same(c.applies_when_text, n.applies_when_text)) fields.push('applies_when');
    if (!same(c.condition, n.condition)) fields.push('condition');
    if (fields.length > 0) changes.push({ kind: 'changed', requirementId: id, title: n.title, fields });
  }
  for (const [id, c] of current) {
    if (!next.has(id)) changes.push({ kind: 'removed', requirementId: id, title: c.title });
  }
  return changes;
}
