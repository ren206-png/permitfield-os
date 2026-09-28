import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath()', () => {
  it('allows invitation links only', () => {
    const invite = `/invite/${'a'.repeat(43)}`;
    expect(safeNextPath(invite)).toBe(invite);
    expect(safeNextPath('/applications')).toBeNull();
    expect(safeNextPath('https://evil.example/invite/x')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath(`${invite}?x=1`)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
