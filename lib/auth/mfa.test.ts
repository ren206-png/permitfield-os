import { describe, it, expect } from 'vitest';
import { needsMfaChallenge } from './mfa';

describe('needsMfaChallenge()', () => {
  it('asks for a code only when a factor is set up and not yet verified this session', () => {
    expect(needsMfaChallenge({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe(true);
    expect(needsMfaChallenge({ currentLevel: 'aal2', nextLevel: 'aal2' })).toBe(false);
    expect(needsMfaChallenge({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe(false);
    expect(needsMfaChallenge(null)).toBe(false);
  });
});
