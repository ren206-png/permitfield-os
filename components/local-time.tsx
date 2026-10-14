'use client';

import { useSyncExternalStore } from 'react';
import { FALLBACK_TIME_ZONE, formatDateTime } from '@/lib/format/date-time';

const subscribe = () => () => {};

// A date or time in the viewer's own time zone. The server render (and the
// hydration pass) uses FALLBACK_TIME_ZONE so the HTML matches; the browser
// then re-renders in its own zone. See lib/format/date-time.ts.
export function LocalTime({ value, dateOnly = false }: { value: string | number | Date; dateOnly?: boolean }) {
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false);
  const text = formatDateTime(value, { dateOnly, timeZone: inBrowser ? undefined : FALLBACK_TIME_ZONE });
  if (text === null) return null;
  return <time dateTime={new Date(value).toISOString()}>{text}</time>;
}
