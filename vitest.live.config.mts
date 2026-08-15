import { defineConfig } from 'vitest/config';
import path from 'node:path';

// This repo's first LIVE-Supabase vitest config (Gate 2.0 sub-phase 2.4).
// Deliberately separate from vitest.config.mts (and run via its own
// `npm run test:live`, never `npm test`): these tests need two real local
// Postgres instances up (`supabase start` for project 1,
// `supabase --workdir supabase-client-portal start` for project 2) and real
// CLIENT_PORTAL_SUPABASE_*/NEXT_PUBLIC_SUPABASE_*/SUPABASE_SERVICE_ROLE_KEY
// credentials -- neither is true in the environment vitest.config.mts's
// plain `**/*.test.ts` glob runs in (CI's build-and-test job has no
// Docker/Supabase step at all; see that job's own comment in
// .github/workflows/ci.yml). Keeping this in one shared config/include
// would make every future `*.test.ts` file added under lib/ a candidate for
// silently trying (and failing, or worse -- hanging on a connection retry)
// to reach a live DB that isn't running.
//
// Naming convention: live tests are named `*.live.test.ts`, excluded from
// vitest.config.mts's include and picked up only here -- see this repo's
// first one, lib/bridge/client-portal.live.test.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    include: ['**/*.live.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    setupFiles: ['./vitest.live.setup.ts'],
    // Real network round-trips across two local Postgres instances (plus,
    // for the download-URL test, a real Storage upload/sign) are slower
    // than the pure-function unit tests vitest.config.mts times for --
    // the default 5s per-test timeout is too tight for a cold local
    // connection pool.
    testTimeout: 15000,
  },
});
