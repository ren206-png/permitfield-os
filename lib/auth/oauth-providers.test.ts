import { describe, it, expect } from 'vitest';
import { enabledProvidersFromSettings } from './oauth-providers';

describe('enabledProvidersFromSettings()', () => {
  it('lists only the supported providers that are switched on', () => {
    expect(enabledProvidersFromSettings({ external: { email: true, google: true, azure: false, github: true } })).toEqual(['google']);
    expect(enabledProvidersFromSettings({ external: { google: true, azure: true } })).toEqual(['google', 'azure']);
    expect(enabledProvidersFromSettings({ external: { email: true } })).toEqual([]);
    expect(enabledProvidersFromSettings(null)).toEqual([]);
  });
});
