import { describe, expect, it } from 'vitest';
import { changedHunks, diffLines, MAX_DIFF_LINES } from './diff';
import { computeFreshness, isCheckDue } from './freshness';
import { buildPublishItems, diffRuleSet, stableStringify, type LiveRequirement } from './rule-set-publish';

describe('diffLines', () => {
  it('reports added and removed lines and keeps context', () => {
    const before = '[Fees]\nResidential: $10\nCommercial: $20\nFooter';
    const after = '[Fees]\nResidential: $12\nCommercial: $20\nFooter';
    const diff = diffLines(before, after);
    expect(diff).toMatchObject({ computed: true, added: 1, removed: 1 });
    if (!diff.computed) return;
    expect(diff.ops.filter((o) => o.op !== 'same')).toEqual([
      { op: 'removed', line: 'Residential: $10' },
      { op: 'added', line: 'Residential: $12' },
    ]);
    expect(changedHunks(diff.ops, 0)).toEqual([
      { op: 'gap', count: 1 },
      { op: 'removed', line: 'Residential: $10' },
      { op: 'added', line: 'Residential: $12' },
      { op: 'gap', count: 2 },
    ]);
  });

  it('identical text has no changes', () => {
    expect(diffLines('a\nb', 'a\n\nb')).toMatchObject({ computed: true, added: 0, removed: 0 });
  });

  it('refuses rather than half-diffing a huge text', () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `line ${i}`).join('\n');
    expect(diffLines(big, 'x')).toMatchObject({ computed: false, reason: 'too_large' });
  });
});

describe('freshness', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  it('is per source type', () => {
    expect(computeFreshness('fee_schedule', '2026-10-01T00:00:00Z', now)).toBe('fresh');
    expect(computeFreshness('fee_schedule', '2026-09-01T00:00:00Z', now)).toBe('overdue');
    expect(computeFreshness('bylaw', '2026-09-01T00:00:00Z', now)).toBe('fresh');
    expect(computeFreshness('bylaw', null, now)).toBe('never_checked');
  });

  it('a failed attempt is retried after a day, and never counts as a successful check', () => {
    expect(isCheckDue('forms_page', '2026-09-01T00:00:00Z', '2026-10-28T06:00:00Z', now)).toBe(false);
    expect(isCheckDue('forms_page', '2026-09-01T00:00:00Z', '2026-10-27T06:00:00Z', now)).toBe(true);
    expect(isCheckDue('forms_page', null, null, now)).toBe(true);
    expect(isCheckDue('forms_page', '2026-10-20T00:00:00Z', null, now)).toBe(false);
  });
});

describe('buildPublishItems', () => {
  const live: LiveRequirement[] = [
    { id: '00000000-0000-4000-8000-00000000000a', title: 'Site plan', description: null, appliesWhen: null },
    { id: '00000000-0000-4000-8000-00000000000b', title: 'Strata approval', description: null, appliesWhen: 'If strata titled.' },
  ];
  const [A, B] = live.map((r) => r.id);

  it('builds items; a blank condition is null', () => {
    const result = buildPublishItems(live, [
      { requirementId: A, include: true, conditionJson: '' },
      { requirementId: B, include: true, conditionJson: '{"fact":"building.strata_titled","op":"eq","value":true}' },
    ]);
    expect(result).toEqual({
      ok: true,
      items: [
        { permit_requirement_id: A, condition: null, requires: [] },
        { permit_requirement_id: B, condition: { fact: 'building.strata_titled', op: 'eq', value: true }, requires: [] },
      ],
    });
  });

  it('refuses bad JSON, an invalid condition, an unknown requirement and an empty set', () => {
    expect(buildPublishItems(live, [{ requirementId: A, include: true, conditionJson: '{oops' }])).toMatchObject({ ok: false });
    expect(buildPublishItems(live, [{ requirementId: A, include: true, conditionJson: '{"fact":"x","op":"matches","value":".*"}' }])).toMatchObject({ ok: false });
    expect(buildPublishItems(live, [{ requirementId: '00000000-0000-4000-8000-0000000000ff', include: true, conditionJson: '' }])).toMatchObject({ ok: false });
    expect(buildPublishItems(live, [{ requirementId: A, include: false, conditionJson: '' }])).toMatchObject({ ok: false });
  });
});

describe('diffRuleSet', () => {
  it('finds added, removed and changed requirements, ignoring jsonb key order', () => {
    const current = new Map([
      ['a', { title: 'Site plan', condition: { op: 'eq', fact: 'x.y', value: true } }],
      ['b', { title: 'Old form' }],
    ]);
    const next = new Map([
      ['a', { title: 'Site plan', condition: { fact: 'x.y', op: 'eq', value: true } }],
      ['c', { title: 'New form', applies_when_text: 'If any.' }],
    ]);
    expect(diffRuleSet(current, next)).toEqual([
      { kind: 'added', requirementId: 'c', title: 'New form' },
      { kind: 'removed', requirementId: 'b', title: 'Old form' },
    ]);
    expect(diffRuleSet(new Map([['a', { title: 'A', description: 'x' }]]), new Map([['a', { title: 'A', description: 'y' }]]))).toEqual([
      { kind: 'changed', requirementId: 'a', title: 'A', fields: ['description'] },
    ]);
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
