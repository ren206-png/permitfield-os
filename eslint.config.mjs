import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Gate 2.0 §3's structural-enforcement mechanism 1 of 2 (module boundary,
// lint-enforced -- see GATE_2_0_SPEC.md §3 and its "Current status of the
// two mechanisms (K.5/L.1)" note: this is the ENTIRE enforced boundary
// today, mechanism 2 having no deploy target to attach to yet). Only
// lib/bridge/client-portal.ts (and, added in sub-phase 2.4, its own live
// test file, lib/bridge/client-portal.live.test.ts) may import the
// second-project service-role client constructor
// (lib/supabase/client-portal-service-client.ts) -- every other file in the
// repo is forbidden from importing it, whether by the "@/" alias or a
// relative path, so this build fails if a future author wires that
// credential into a route handler, Server Action, or any other module
// acting on behalf of an end user or org staff session. The test-file
// exemption is narrow and deliberate, not a loosening of the boundary: that
// file's whole job is inserting/mutating client_access_tokens fixture rows
// directly (status transitions, deliberately mismatched application_id/
// org_id pairs) to prove the bridge module's authorization logic -- work
// that has to bypass the bridge's own public functions to set up, the same
// reason supabase/tests/*.test.sql fixtures write directly to tables no
// application code writes to.
//
// Sub-phase 2.6 (GATE_2_0_FINDINGS.md §O.2, decided) adds a third file,
// lib/bridge/client-portal-admin.ts, and its own live test file
// (lib/bridge/client-portal-admin.live.test.ts) -- the staff-facing
// sibling module (issueToken/revokeToken), authorized against project 1's
// org membership rather than a project-2 token. It needs the identical
// credential for the identical reason (it writes client_access_tokens/
// token_lifecycle_events), and gets its own allow-list entry rather than
// being folded into client-portal.ts, so that file's own docstring claim
// ("the entire enumerated operation set §3 defines") stays true.
const clientPortalServiceClientRestriction = {
  files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  ignores: [
    "lib/bridge/client-portal.ts",
    "lib/bridge/client-portal.live.test.ts",
    "lib/bridge/client-portal-admin.ts",
    "lib/bridge/client-portal-admin.live.test.ts",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "**/client-portal-service-client",
              "**/client-portal-service-client.ts",
            ],
            message:
              "lib/supabase/client-portal-service-client.ts (the second, dedicated Supabase project's service-role client) may only be imported from lib/bridge/client-portal.ts, lib/bridge/client-portal-admin.ts, or either module's own live test file -- see those modules' header comments and GATE_2_0_SPEC.md §3's structural-enforcement mechanism.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  clientPortalServiceClientRestriction,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // supabase CLI's local Edge Runtime bundle -- vendored/generated, not
    // project source. "**/" prefix (not just "supabase/.temp/**") so this
    // also covers project 2's stack (supabase-client-portal/supabase/.temp/**),
    // which generates the identical kind of bundle under `supabase --workdir
    // supabase-client-portal start` -- caught by 2.4 when that stack's local
    // dev run left one behind and `npm run lint` flagged it as 150+ errors of
    // real source.
    "**/supabase/.temp/**",
  ]),
]);

export default eslintConfig;
