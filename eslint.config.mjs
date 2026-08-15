import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Gate 2.0 §3's structural-enforcement mechanism 1 of 2 (module boundary,
// lint-enforced -- see GATE_2_0_SPEC.md §3 and its "Current status of the
// two mechanisms (K.5/L.1)" note: this is the ENTIRE enforced boundary
// today, mechanism 2 having no deploy target to attach to yet). Only
// lib/bridge/client-portal.ts may import the second-project service-role
// client constructor (lib/supabase/client-portal-service-client.ts) -- every
// other file in the repo is forbidden from importing it, whether by the "@/"
// alias or a relative path, so this build fails if a future author wires
// that credential into a route handler, Server Action, or any other module
// acting on behalf of an end user or org staff session.
const clientPortalServiceClientRestriction = {
  files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  ignores: ["lib/bridge/client-portal.ts"],
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
              "lib/supabase/client-portal-service-client.ts (the second, dedicated Supabase project's service-role client) may only be imported from lib/bridge/client-portal.ts -- see that module's header comment and GATE_2_0_SPEC.md §3's structural-enforcement mechanism.",
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
    // supabase CLI's local Edge Runtime bundle -- vendored/generated, not project source.
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
