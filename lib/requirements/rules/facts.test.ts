import { describe, expect, it } from 'vitest';
import { resolveFacts, type ProjectFactRow } from './facts';

const row = (r: Partial<ProjectFactRow> & Pick<ProjectFactRow, 'id' | 'state' | 'created_at'>): ProjectFactRow => ({
  fact_key: 'project.floor_area',
  value: 111,
  unit: 'm2',
  supersedes_fact_id: null,
  ...r,
});

describe('resolveFacts', () => {
  it('only a confirmed fact counts; a lone proposal is awaiting confirmation; only-rejected is missing', () => {
    const { facts } = resolveFacts([
      row({ id: 'a', state: 'confirmed', created_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'b', fact_key: 'building.strata_titled', value: true, unit: null, state: 'proposed', created_at: '2026-10-02T00:00:00Z' }),
      row({ id: 'c', fact_key: 'use.group', value: 'E', unit: null, state: 'rejected', created_at: '2026-10-03T00:00:00Z' }),
    ]);
    expect(facts.get('project.floor_area')).toEqual({ status: 'confirmed', factId: 'a', value: 111, unit: 'm2' });
    expect(facts.get('building.strata_titled')).toEqual({ status: 'awaiting_confirmation' });
    expect(facts.has('use.group')).toBe(false);
  });

  it('a confirmed correction supersedes; a proposed or rejected one never hides the confirmed value', () => {
    const base = row({ id: 'a', state: 'confirmed', created_at: '2026-10-01T00:00:00Z' });
    const proposedFix = row({ id: 'b', value: 118, state: 'proposed', supersedes_fact_id: 'a', created_at: '2026-10-02T00:00:00Z' });
    const rejectedFix = row({ id: 'c', value: 999, state: 'rejected', supersedes_fact_id: 'a', created_at: '2026-10-03T00:00:00Z' });

    const pending = resolveFacts([base, proposedFix, rejectedFix]);
    expect(pending.facts.get('project.floor_area')).toMatchObject({ status: 'confirmed', factId: 'a', value: 111 });
    expect(pending.pendingProposals).toEqual(['project.floor_area']);

    const confirmedFix = row({ id: 'd', value: 118, state: 'confirmed', supersedes_fact_id: 'a', created_at: '2026-10-04T00:00:00Z' });
    const settled = resolveFacts([base, proposedFix, rejectedFix, confirmedFix]);
    expect(settled.facts.get('project.floor_area')).toMatchObject({ status: 'confirmed', factId: 'd', value: 118 });
  });
});
