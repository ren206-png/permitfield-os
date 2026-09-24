import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production incident follow-up (found while checking whether the
  // deadline-reminders Inngest cron -- lib/inngest/functions/reminders.ts --
  // was actually firing): app/api/inngest/route.ts registers
  // permitExtract/permitClassifyDocuments/permitDrawingReview alongside the
  // reminders cron in one route module, and all three import
  // lib/pdf/text-density.ts -> `pdf-parse` -> `pdfjs-dist`, which requires
  // `@napi-rs/canvas` (a native, per-platform binary) at module-evaluation
  // time to polyfill the `DOMMatrix` global. Bundling that native package
  // into the traced serverless function (the default for anything imported
  // by a route) let a working macOS binary get resolved locally but left
  // the correct linux binary un-traced in Vercel's actual deployment,
  // producing "ReferenceError: DOMMatrix is not defined" the moment the
  // bundle was evaluated -- which crashed the *entire* /api/inngest route
  // (GET sync and POST invocation alike, for every function registered on
  // it, not just the three that use text-density.ts) rather than failing
  // only the PDF-parsing call path. Declaring these as external server
  // packages tells Next.js to `require()` them from the real node_modules
  // at runtime instead of statically tracing/bundling them, which is the
  // standard fix for native/platform-specific npm packages on Vercel.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Pins Turbopack's project root to this repo explicitly. Without this,
  // Turbopack infers the root by walking up from here looking for a
  // lockfile, and a stray package-lock.json one level up (outside this git
  // repo, on a contributor's machine) gets picked up instead -- Next.js
  // then warns and ignores it, and dev-mode file watching/module
  // resolution is scoped to the wrong directory. `__dirname` is this
  // file's own directory (the repo root), so this is correct regardless of
  // what a given machine's parent directories happen to contain.
  turbopack: {
    root: __dirname,
  },
  // LP workstream, Phase 2 (LP_PHASE_0_FINDINGS.md SS0.4): the apex host
  // (permitfieldos.com) and the canonical/OG host (www.permitfieldos.com)
  // both served 200 with no redirect between them as of the Phase 0 audit
  // -- the canonical tag was correct but unenforced, leaving a
  // duplicate-content signal for crawlers to resolve on trust alone. This
  // makes www authoritative at the routing layer so served host and
  // declared canonical agree. Permanent (308) since this is a lasting
  // domain decision, not a temporary redirect.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "permitfieldos.com" }],
        destination: "https://www.permitfieldos.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
