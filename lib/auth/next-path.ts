// Where sign-in may send someone afterwards. Only paths this app hands out
// itself are allowed -- an arbitrary `next` would be an open redirect.
const ALLOWED_NEXT = [/^\/invite\/[A-Za-z0-9_-]{43}$/];

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALLOWED_NEXT.some((pattern) => pattern.test(value)) ? value : null;
}
