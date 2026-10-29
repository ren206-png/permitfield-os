import { describe, expect, it } from 'vitest';
import { buildManifest, type ManifestInput } from './manifest';

const input = (over: Partial<ManifestInput> = {}): ManifestInput => ({
  application: { id: 'a', title: 'Unit 4', address: '1 Main St', permitType: 'TI', municipality: 'Toronto, ON', permitStatus: 'ready_to_submit' },
  forms: [{ id: 'f1', filingId: 'fil', filename: 'form.pdf', fillMethod: 'acroform', createdAt: '2026-10-01T00:00:00Z', incompleteRequired: [] }],
  attachments: [
    { id: 'd2', filename: 'A-101.pdf', kind: 'blueprint', sha256: 'b'.repeat(64), byteSize: 1000, revision: 2, uploadedAt: '2026-10-02T00:00:00Z' },
    { id: 'd1', filename: 'scope.pdf', kind: 'scope_of_work', sha256: 'c'.repeat(64), byteSize: 500, revision: 1, uploadedAt: '2026-10-01T00:00:00Z' },
  ],
  confirmedFacts: [{ key: 'project.floor_area', value: 118, unit: 'm2', factId: 'x' }],
  factsAwaitingConfirmation: [],
  checklist: [{ title: 'Site plan', required: true, status: 'complete' }],
  ruleCheck: { evaluatedAt: '2026-10-03T00:00:00Z', applicable: 5, notApplicable: 1, unknown: 0 },
  feeEstimate: { status: 'estimated', totalMinor: 202_823, currency: 'CAD', computedAt: '2026-10-03T00:00:00Z' },
  preparedBy: 'u',
  preparedAt: '2026-10-04T00:00:00Z',
  ...over,
});

describe('buildManifest', () => {
  it('pins attachments by hash, is always a draft, and has nothing unresolved when everything is in place', () => {
    const { manifest, sha256 } = buildManifest(input());
    expect(manifest.status).toBe('draft');
    expect(manifest.attachments.map((a) => a.id)).toEqual(['d1', 'd2']);
    expect(manifest.attachments[1].sha256).toBe('b'.repeat(64));
    expect(manifest.unresolved).toEqual([]);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the hash is stable for the same content regardless of input order, and changes when a file changes', () => {
    const a = buildManifest(input()).sha256;
    const reordered = buildManifest(input({ attachments: [...input().attachments].reverse() })).sha256;
    expect(reordered).toBe(a);
    const changed = input();
    changed.attachments[0] = { ...changed.attachments[0], sha256: 'd'.repeat(64) };
    expect(buildManifest(changed).sha256).not.toBe(a);
  });

  it('lists every unresolved item instead of hiding it', () => {
    const { manifest } = buildManifest(
      input({
        forms: [{ id: 'f1', filingId: 'fil', filename: 'form.pdf', fillMethod: 'overlay', createdAt: 't', incompleteRequired: ['Owner signature date'] }],
        checklist: [{ title: 'Structural letter', required: true, status: 'pending' }, { title: 'Optional photos', required: false, status: 'pending' }],
        factsAwaitingConfirmation: ['electrical.service_amps'],
        ruleCheck: { evaluatedAt: 't', applicable: 1, notApplicable: 0, unknown: 3 },
        feeEstimate: { status: 'unavailable', totalMinor: null, currency: null, computedAt: 't' },
      })
    );
    expect(manifest.unresolved).toEqual([
      'Checklist: Structural letter (pending)',
      'Form form.pdf: required field "Owner signature date" is empty',
      'Fact awaiting confirmation: electrical.service_amps',
      'Requirements check: 3 requirement(s) unknown',
      'Fee estimate: unavailable',
    ]);
  });

  it('a package with no form, no rule check and no fee says so', () => {
    const { manifest } = buildManifest(input({ forms: [], ruleCheck: null, feeEstimate: null }));
    expect(manifest.unresolved).toEqual(['No filled form is included', 'Requirements check not run', 'Fee not estimated']);
  });
});
