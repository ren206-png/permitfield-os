import { describe, it, expect } from 'vitest';
import { newPasswordProblem, recoveryTokenHash } from './recovery';

describe('recoveryTokenHash()', () => {
  const hash = 'pkce_0123456789abcdef0123456789abcdef0123456789abcdef01234567';

  it('accepts a recovery link', () => {
    expect(recoveryTokenHash({ token_hash: hash, type: 'recovery' })).toBe(hash);
  });

  it('rejects other link types and malformed hashes', () => {
    expect(recoveryTokenHash({ token_hash: hash, type: 'signup' })).toBeNull();
    expect(recoveryTokenHash({ token_hash: hash })).toBeNull();
    expect(recoveryTokenHash({ token_hash: 'short', type: 'recovery' })).toBeNull();
    expect(recoveryTokenHash({ token_hash: `${hash}<script>`, type: 'recovery' })).toBeNull();
    expect(recoveryTokenHash({ token_hash: ['a', 'b'], type: 'recovery' })).toBeNull();
  });
});

describe('newPasswordProblem()', () => {
  it('requires 10 characters and a matching confirmation', () => {
    expect(newPasswordProblem('short', 'short')).toMatch(/10 characters/);
    expect(newPasswordProblem('long-enough-1', 'long-enough-2')).toMatch(/match/);
    expect(newPasswordProblem('long-enough-1', 'long-enough-1')).toBeNull();
  });
});
