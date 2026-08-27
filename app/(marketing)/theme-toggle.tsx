'use client';

import { useEffect, useState } from 'react';

// Marketing-homepage-only light/dark toggle. Persists to localStorage and
// flips a `dark` class on #marketing-root (see marketing-homepage.tsx) --
// deliberately not on <html>, so this never affects the authenticated app,
// which has no dark-mode styling of its own.
export const MARKETING_THEME_STORAGE_KEY = 'permitfield-marketing-theme';

function setRootDark(isDark: boolean) {
  document.getElementById('marketing-root')?.classList.toggle('dark', isDark);
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // The inline script in marketing-homepage.tsx already applied the
    // class before paint (avoids a flash of the wrong theme); this just
    // syncs component state to what's already on the DOM.
    setIsDark(document.getElementById('marketing-root')?.classList.contains('dark') ?? false);
    setMounted(true);
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    setRootDark(next);
    try {
      window.localStorage.setItem(MARKETING_THEME_STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage can be unavailable (private browsing, disabled cookies,
      // etc.) -- the toggle still works for the current page view.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? (isDark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle color theme'}
      aria-pressed={mounted ? isDark : undefined}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-white"
    >
      {mounted && isDark ? (
        // Sun icon (click to go light)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // Moon icon (click to go dark)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}
