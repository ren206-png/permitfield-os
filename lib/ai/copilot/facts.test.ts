import { describe, expect, it } from 'vitest';
import { FACT_KEYS, isFactKey, parseFactValue } from '@/lib/requirements/rules/fact-keys';
import { ConditionSchema } from '@/lib/requirements/rules/condition';
import { proposalsFromExtraction } from './facts-from-extraction';

const field = <T,>(value: T | null, page: number | null = 2) => ({
  value,
  confidence: 0.8,
  source_document_id: value === null ? null : '8f0e5d2a-1b3c-4d5e-9f00-123456789abc',
  source_page: value === null ? null : page,
});

const extraction = (over: Record<string, unknown> = {}) => ({
  applicant_name: field('Acme'),
  license_number: field('L-1'),
  square_footage: field(118),
  electrical_amps: field<number>(null),
  estimated_job_value_raw: field('$40,000'),
  scope_of_work_summary: field('Interior fit-out'),
  ...over,
});

describe('proposalsFromExtraction', () => {
  it('proposes only structured facts, never a null field', () => {
    expect(proposalsFromExtraction(extraction())).toEqual([
      {
        factKey: 'project.floor_area',
        value: 118,
        unit: 'm2',
        sourceDocumentId: '8f0e5d2a-1b3c-4d5e-9f00-123456789abc',
        sourceLocator: 'p. 2',
        confidence: 0.8,
      },
    ]);
  });

  it('an invalid extraction proposes nothing', () => {
    expect(proposalsFromExtraction({ square_footage: 'big' })).toEqual([]);
    expect(proposalsFromExtraction(null)).toEqual([]);
  });

  it('no locator without a document (the table requires one)', () => {
    const [p] = proposalsFromExtraction(extraction({ square_footage: { value: 50, confidence: 0.5, source_document_id: null, source_page: 3 } }));
    expect(p).toMatchObject({ sourceDocumentId: null, sourceLocator: null });
  });
});

describe('fact keys', () => {
  it('parse form values strictly', () => {
    expect(parseFactValue('project.floor_area', '118.5')).toEqual({ ok: true, value: 118.5, unit: 'm2' });
    for (const bad of ['', '-5', '0', '1e3', '12 m2', 'abc']) expect(parseFactValue('project.floor_area', bad).ok).toBe(false);
    expect(parseFactValue('building.strata_titled', 'yes')).toEqual({ ok: true, value: true, unit: null });
    expect(parseFactValue('building.strata_titled', 'true').ok).toBe(false);
    expect(parseFactValue('building.occupancy_group', 'E')).toEqual({ ok: true, value: 'E', unit: null });
    expect(parseFactValue('building.occupancy_group', 'Z9').ok).toBe(false);
  });

  it('every key is usable in a rule-set condition with its unit', () => {
    expect(isFactKey('project.floor_area')).toBe(true);
    expect(isFactKey('project.floor_areas')).toBe(false);
    for (const [key, def] of Object.entries(FACT_KEYS)) {
      const condition =
        def.kind === 'number'
          ? { fact: key, op: 'gte', value: 1, ...(def.unit ? { unit: def.unit } : {}) }
          : def.kind === 'boolean'
            ? { fact: key, op: 'eq', value: true }
            : { fact: key, op: 'in', value: ['E'] };
      expect(ConditionSchema.safeParse(condition).success).toBe(true);
    }
  });
});
