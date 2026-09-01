import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
