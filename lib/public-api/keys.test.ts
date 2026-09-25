import { describe, it, expect } from 'vitest';
import { DISPLAY_PREFIX_LENGTH, generateApiKey, hashApiKey, isWellFormedApiKey, parseBearerToken } from './keys';

describe('generateApiKey', () => {
  it('produces a well-formed pfk_ key with a matching prefix and hash', () => {
    const { key, prefix, hash } = generateApiKey();
    expect(isWellFormedApiKey(key)).toBe(true);
    expect(key.startsWith('pfk_')).toBe(true);
    expect(prefix).toBe(key.slice(0, DISPLAY_PREFIX_LENGTH));
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
    expect(keys.size).toBe(200);
  });

  it('prefix alone does not reveal enough of the key to authenticate', () => {
    const { key, prefix } = generateApiKey();
    expect(isWellFormedApiKey(prefix)).toBe(false);
    expect(key.length - prefix.length).toBeGreaterThanOrEqual(35);
  });
});

describe('hashApiKey', () => {
  it('is deterministic and matches a known SHA-256 vector', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashApiKey('abc')).toBe(hashApiKey('abc'));
  });
});

describe('parseBearerToken', () => {
  const { key } = generateApiKey();

  it('accepts a well-formed bearer header, case-insensitively', () => {
    expect(parseBearerToken(`Bearer ${key}`)).toBe(key);
    expect(parseBearerToken(`bearer ${key}`)).toBe(key);
    expect(parseBearerToken(`BEARER   ${key}  `)).toBe(key);
  });

  it('rejects missing, non-bearer, and malformed credentials', () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken('')).toBeNull();
    expect(parseBearerToken(key)).toBeNull();
    expect(parseBearerToken(`Basic ${key}`)).toBeNull();
    expect(parseBearerToken('Bearer pfk_short')).toBeNull();
    expect(parseBearerToken(`Bearer ${key}x`)).toBeNull();
    expect(parseBearerToken(`Bearer ${key.replace('pfk_', 'sk_')}`)).toBeNull();
    expect(parseBearerToken(`Bearer ${key} extra`)).toBeNull();
  });
});
