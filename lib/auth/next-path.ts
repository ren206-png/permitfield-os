// Where sign-in may send someone afterwards. Only paths this app hands out
// itself are allowed -- an arbitrary `next` would be an open redirect. Each
// pattern starts with a single '/' and a fixed first segment, so neither
// '//host' nor 'https://host' can match; query strings are not carried.
const ALLOWED_NEXT = [
  /^\/invite\/[A-Za-z0-9_-]{43}$/,
  // A signed-out visitor opening a link into the app (an emailed application
  // link, a bookmark) comes back to that page after signing in.
  /^\/(applications|projects|dashboard|notifications|settings|admin)(\/[A-Za-z0-9_-]+)*$/,
];

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALLOWED_NEXT.some((pattern) => pattern.test(value)) ? value : null;
}
