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
// Health-check audit follow-up: lib/ai/gemini/client.ts now has a dedicated
// test file, lib/ai/gemini/client.test.ts (covering the
// AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS) addition from that same
// audit), added to `ignores` alongside lib/ai/router.ts, following the exact
// precedent set by clientPortalServiceClientRestriction's own test-file
// exemption above. lib/ai/embed.ts (the Voyage client) has no equivalent
// import-boundary rule to exempt from -- it isn't gated by one, since
// VOYAGE_API_KEY has no analogous single-module restriction in this file.
const geminiClientRestriction = {
  files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  ignores: ["lib/ai/router.ts", "lib/ai/gemini/client.test.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/gemini/client", "**/gemini/client.ts"],
            message:
              "lib/ai/gemini/client.ts (the Gemini API client, GEMINI_API_KEY) may only be imported from lib/ai/router.ts or its own test file (lib/ai/gemini/client.test.ts) -- see that module's header comment and GATE_AI_1_FINDINGS.md §H's KEY_LEAK scenario.",
          },
        ],
      },
    ],
  },
};

// Billing build (BILLING_PROPOSAL.md §3), same shape and mechanism as
// geminiClientRestriction above (a no-restricted-imports rule scoped by
// files/ignores), applied to the bare `stripe` npm package instead of a
// relative-path module -- `patterns` (glob-matched relative/aliased
// specifiers) can't match a bare package name, so this uses `paths`
// instead, matching the specifier string exactly. Only
// lib/billing/subscriptions.ts (and, following the exact precedent
// clientPortalServiceClientRestriction set above, its own live test file,
// lib/billing/subscriptions.live.test.ts) may import it -- every other
// file, including app/**, is forbidden, whether by the "@/" alias or a
// direct `from 'stripe'` import, so this build fails if a future author
// wires the Stripe secret key into a route handler, Server Action, or any
// other end-user-facing module. The test-file exemption is narrow and
// deliberate, not a loosening of the boundary: that file's whole job is
// constructing real signed webhook payloads (via `stripe.webhooks.
// generateTestHeaderString()`) to exercise handleStripeWebhookEvent()'s
// actual signature-verification path, work that has to import the SDK
// directly to build a valid `Stripe-Signature` header -- the same
// "bypasses the module's own public functions to set up" reason
// client-portal.live.test.ts's own header gives for its exemption. Same
// "only one designated module reads this credential" discipline as
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET's own .env.example comments.
const stripeClientRestriction = {
  files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
  ignores: ["lib/billing/subscriptions.ts", "lib/billing/subscriptions.live.test.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "stripe",
            message:
              "The stripe package (STRIPE_SECRET_KEY) may only be imported from lib/billing/subscriptions.ts -- see that module's header comment and BILLING_PROPOSAL.md §3.",
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
  stripeClientRestriction,
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
