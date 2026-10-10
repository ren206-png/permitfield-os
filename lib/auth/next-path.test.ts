import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath()', () => {
  it('allows invitation links', () => {
    const invite = `/invite/${'a'.repeat(43)}`;
    expect(safeNextPath(invite)).toBe(invite);
    expect(safeNextPath(`${invite}?x=1`)).toBeNull();
  });

  it('allows paths inside the app', () => {
    expect(safeNextPath('/applications')).toBe('/applications');
    expect(safeNextPath('/applications/33c4aa26-f4c4-49d5-9e0e-5a758ae53cd8')).toBe(
      '/applications/33c4aa26-f4c4-49d5-9e0e-5a758ae53cd8'
    );
    expect(safeNextPath('/settings/team')).toBe('/settings/team');
    expect(safeNextPath('/admin/requirements')).toBe('/admin/requirements');
  });

  it('refuses anything that could leave the site', () => {
    expect(safeNextPath('https://evil.example/invite/x')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/applications//evil.example')).toBeNull();
    expect(safeNextPath('/applications/../login')).toBeNull();
    expect(safeNextPath('/applications?x=https://evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('/unknown')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
