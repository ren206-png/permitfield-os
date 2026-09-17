import { describe, expect, it } from 'vitest';
import {
  buildPanelRows,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  type ProjectStatus,
} from './labels';

describe('buildPanelRows', () => {
  it('returns one row per value in `order`, in that order', () => {
    const counts = new Map<ProjectStatus, number>([['active', 3]]);
    const rows = buildPanelRows(PROJECT_STATUS_ORDER, PROJECT_STATUS_LABELS, counts);

    expect(rows.map((r) => r.label)).toEqual(['Draft', 'Active', 'On hold', 'Completed', 'Archived']);
  });

  it('defaults a status missing from the RPC result to 0, not omitted', () => {
    const counts = new Map<ProjectStatus, number>([['draft', 2]]);
    const rows = buildPanelRows(PROJECT_STATUS_ORDER, PROJECT_STATUS_LABELS, counts);

    const archived = rows.find((r) => r.label === 'Archived');
    expect(archived).toEqual({ label: 'Archived', count: 0 });
  });

  it('a totally empty counts map (the documented "0-row RPC result" case) yields all-zero rows, not an empty array', () => {
    const rows = buildPanelRows(PROJECT_STATUS_ORDER, PROJECT_STATUS_LABELS, new Map());

    expect(rows).toHaveLength(PROJECT_STATUS_ORDER.length);
    expect(rows.every((r) => r.count === 0)).toBe(true);
  });
});
