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
const clientPortalServiceClientRestriction = {
  files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  ignores: ["lib/bridge/client-portal.ts", "lib/bridge/client-portal.live.test.ts"],
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
              "lib/supabase/client-portal-service-client.ts (the second, dedicated Supabase project's service-role client) may only be imported from lib/bridge/client-portal.ts or its own live test file (lib/bridge/client-portal.live.test.ts) -- see that module's header comment and GATE_2_0_SPEC.md §3's structural-enforcement mechanism.",
          },
        ],
      },
    ],
  },
};

// Gate AI-1, sub-phase AI-1.1's answer to the KEY_LEAK adversarial scenario
// (GATE_AI_1_FINDINGS.md §H) -- same shape and mechanism as
// clientPortalServiceClientRestriction above (a no-restricted-imports rule
// scoped by files/ignores), applied to lib/ai/gemini/client.ts, the only
// module in this repo permitted to read GEMINI_API_KEY (see that file's own
// header). Only lib/ai/router.ts may import it -- every other file,
// including app/**, is forbidden, whether by the "@/" alias or a relative
// path, so this build fails if a future author wires the Gemini key into a
// route handler, Server Action, or any other end-user-facing module.
//
// Unlike clientPortalServiceClientRestriction, there is no separate
// live-test-file exemption here: lib/ai/gemini/client.ts has no dedicated
// test file yet (same as the existing Voyage client, lib/ai/embed.ts, which
// also has none -- see that module's header for why: a thin REST wrapper
// with no local logic to unit-test in isolation, exercised live via
// eval/run.ts instead). If a future test needs one, add it to `ignores`
// alongside lib/ai/router.ts at that time, following the exact precedent
// set by clientPortalServiceClientRestriction's own test-file exemption.
const geminiClientRestriction = {
  files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  ignores: ["lib/ai/router.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/gemini/client", "**/gemini/client.ts"],
            message:
              "lib/ai/gemini/client.ts (the Gemini API client, GEMINI_API_KEY) may only be imported from lib/ai/router.ts -- see that module's header comment and GATE_AI_1_FINDINGS.md §H's KEY_LEAK scenario.",
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
  geminiClientRestriction,
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
