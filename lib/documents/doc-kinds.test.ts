import { describe, it, expect } from 'vitest';
import { docKindLabel } from './doc-kinds';

describe('docKindLabel()', () => {
  it('labels each document kind', () => {
    expect(docKindLabel('scope_of_work')).toBe('Scope of work');
    expect(docKindLabel('spec_sheet')).toBe('Spec sheet');
    expect(docKindLabel('blueprint')).toBe('Blueprint');
  });

  it('falls back to the raw value for an unknown kind', () => {
    expect(docKindLabel('something_new')).toBe('something_new');
  });
});
