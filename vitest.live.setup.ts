// Live-Supabase test setup (Gate 2.0 sub-phase 2.4 -- this repo's first
// live-Supabase vitest suite; see vitest.live.config.mts's own header for
// why this is a separate config from vitest.config.mts).
//
// Loads .env.local by hand rather than relying on Vite/Vitest's built-in
// loadEnv: Vite deliberately SKIPS .env.local when mode === 'test' (vitest's
// default mode) -- specifically so a test run doesn't silently depend on
// one developer's local secrets and produce different results for someone
// else. That skip is the right default for vitest.config.mts's pure-function
// unit tests, but this suite's entire purpose is the opposite: run against
// THIS developer's local Supabase stacks (`supabase start` +
// `supabase --workdir supabase-client-portal start`). CI supplies the
// identical variable names directly as step env (see
// .github/workflows/ci.yml's test:live step) -- this file only fills gaps,
// never overwriting a value the environment already set, so CI's values
// always win over anything a stray .env.local would contain.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const envLocalPath = path.resolve(import.meta.dirname, '.env.local');

if (existsSync(envLocalPath)) {
  const contents = readFileSync(envLocalPath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
