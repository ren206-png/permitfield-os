// Gate 6.4: the project facts PermitField knows how to collect, with each
// value's type and unit. Rule-set conditions (condition.ts) compare against
// these keys; the copilot page lets staff enter or confirm them. A key not
// listed here can still exist in project_facts (the column only checks its
// shape), but the UI only offers these, so a typo can't create a fact no
// condition will ever read.

export type FactKind = 'number' | 'boolean' | 'enum';

export interface FactKeyDefinition {
  label: string;
  kind: FactKind;
  unit: string | null;
  values?: readonly string[];
  hint?: string;
}

export const FACT_KEYS = {
  'project.floor_area': { label: 'Floor area of the work', kind: 'number', unit: 'm2', hint: 'square metres' },
  'electrical.service_amps': { label: 'Electrical service size', kind: 'number', unit: 'A', hint: 'amps' },
  'building.strata_titled': { label: 'Building is strata-titled', kind: 'boolean', unit: null },
  'project.change_of_use': { label: 'Change of use or occupancy', kind: 'boolean', unit: null },
  'project.food_service': { label: 'Food service or commercial kitchen', kind: 'boolean', unit: null },
  'project.structural_changes': { label: 'Structural changes', kind: 'boolean', unit: null },
  'building.sprinklered': { label: 'Building is sprinklered', kind: 'boolean', unit: null },
  'building.occupancy_group': {
    label: 'Major occupancy (building code group)',
    kind: 'enum',
    unit: null,
    values: ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'C', 'D', 'E', 'F1', 'F2', 'F3'],
  },
} as const satisfies Record<string, FactKeyDefinition>;

export type FactKey = keyof typeof FACT_KEYS;

export function isFactKey(key: string): key is FactKey {
  return Object.hasOwn(FACT_KEYS, key);
}

export type ParsedFactValue = { ok: true; value: number | boolean | string; unit: string | null } | { ok: false; error: string };

// Parses a form value for a known key. Numbers must be finite and positive;
// booleans are "yes"/"no"; enums must be one of the listed values. Never
// coerces anything else.
export function parseFactValue(key: FactKey, raw: string): ParsedFactValue {
  const def: FactKeyDefinition = FACT_KEYS[key];
  const text = raw.trim();
  if (def.kind === 'number') {
    if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: `${def.label}: enter a number.` };
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: `${def.label}: enter a number above zero.` };
    return { ok: true, value, unit: def.unit };
  }
  if (def.kind === 'boolean') {
    if (text === 'yes') return { ok: true, value: true, unit: null };
    if (text === 'no') return { ok: true, value: false, unit: null };
    return { ok: false, error: `${def.label}: choose yes or no.` };
  }
  if (!def.values?.includes(text)) return { ok: false, error: `${def.label}: choose one of the listed values.` };
  return { ok: true, value: text, unit: null };
}

export function describeFactValue(key: string, value: unknown, unit: string | null): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const suffix = unit === 'm2' ? ' m²' : unit ? ` ${unit}` : '';
  return `${String(value)}${suffix}`;
}
