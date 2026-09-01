import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
