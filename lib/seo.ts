// Marketing Homepage v2, Phase 3. Canonical origin for SEO artifacts
// (app/sitemap.ts, app/robots.ts, app/page.tsx's generateMetadata, and the
// marketing homepage's JSON-LD). Not derivable from this repo alone --
// MARKETING_PHASE_0_FINDINGS.md SS6 flagged that supabase/config.toml only
// has the local `http://127.0.0.1:3000` value, nothing production-facing.
// Confirmed live and correctly configured directly with Ren in chat
// (DNS/SSL verified against both the apex and www hosts before this phase),
// not a repo-derived or fabricated claim. Overridable via
// NEXT_PUBLIC_SITE_URL so a preview/staging deploy doesn't emit production
// URLs into its own sitemap/canonical tags.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.permitfieldos.com';
