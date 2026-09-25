import { createHash, randomBytes } from 'node:crypto';

// Format: "pfk_" + base64url(32 random bytes). 256 bits of entropy makes
// guessing infeasible, so the per-IP denied-attempt limit in handler.ts is
// defense-in-depth, not the thing that makes keys safe.
const KEY_PREFIX = 'pfk_';
const KEY_RANDOM_BYTES = 32;
const KEY_PATTERN = /^pfk_[A-Za-z0-9_-]{43}$/;
export const DISPLAY_PREFIX_LENGTH = 12;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const key = KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString('base64url');
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashApiKey(key) };
}

export function isWellFormedApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

// Returns the key only for a well-formed "Bearer pfk_..." header, so a
// malformed credential is rejected before any DB lookup.
export function parseBearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const match = /^bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) {
    return null;
  }
  return isWellFormedApiKey(match[1]) ? match[1] : null;
}
