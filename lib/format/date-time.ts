// Dates and times shown in the app. Server components render on Vercel in
// UTC, so `new Date(x).toLocaleString()` there showed e.g. "2:30 PM" for a
// form signed at 8:30 a.m. in Edmonton. Times are formatted in the viewer's
// own time zone by components/local-time.tsx; this module holds the format
// so server and browser render the same shape.

// Used for the server-rendered first paint, before the browser takes over
// with the viewer's real zone (and for anything with no browser, like email).
// Most early customers are in Alberta and BC; the zone name is always shown
// on times, so a pre-hydration paint in this zone is never ambiguous.
export const FALLBACK_TIME_ZONE = 'America/Edmonton';

export function formatDateTime(
  value: string | number | Date,
  { dateOnly = false, timeZone }: { dateOnly?: boolean; timeZone?: string } = {}
): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    ...(timeZone ? { timeZone } : {}),
  });
}
