# DELIVERY_REPORT.md — Marketing Homepage v2

Branch: `feat/marketing-homepage-v2` (4 commits ahead of `main`: `f2306d0`, `43a7606`,
`99394e6`, `d6a14b2`). Not merged — this report closes out Phase 4 (QA) of the
phase-gated build; merge/deploy is a separate decision for Ren.

## 1. What shipped

A marketing homepage for unauthenticated visitors to `/`, gated behind
`NEXT_PUBLIC_MARKETING_V2` (default `false`). When off, the app behaves
exactly as it did before this branch existed (verified in §3). When on:

- `/` renders a real homepage (hero, how-it-works, capabilities, coverage,
  footer CTA) instead of redirecting straight to `/login`.
- `/robots.txt` and `/sitemap.xml` serve real, crawlable content instead of
  disallowing/omitting everything.
- The homepage carries proper `<title>`, meta description, canonical URL,
  Open Graph, and Twitter Card tags, plus JSON-LD (`Organization` + `WebSite`).
- Vercel Web Analytics is mounted on this route only.

Every phase's deliverable is committed separately (one commit per phase, per
the master prompt's hard rules):

| Commit | Phase | Contents |
|---|---|---|
| `f2306d0` | 0 | `MARKETING_PHASE_0_FINDINGS.md`, `MARKETING_CAPABILITY_LEDGER.md` (read-only audit) |
| `43a7606` | 1 | `IMPLEMENTATION_PLAN.md`, `COPY_DECK.md` (no code) |
| `99394e6` | 2 | Flag + homepage implementation |
| `d6a14b2` | 3 | SEO, structured data, analytics |

## 2. File inventory (20 files, +1259/-8 vs `main`)

**New code:**
`app/(marketing)/marketing-homepage.tsx`, `app/(marketing)/sections/{hero,how-it-works,capabilities,coverage,footer-cta}.tsx`,
`app/(marketing)/structured-data.tsx`, `app/robots.ts`, `app/sitemap.ts`, `lib/seo.ts`

**Modified code:**
`app/page.tsx` (own auth check + `generateMetadata`), `proxy.ts` (marketing +
SEO route allowlist), `lib/flags.ts` (+`isMarketingV2Enabled()`), `package.json`/`package-lock.json` (+`@vercel/analytics`)

**Docs:**
`MARKETING_PHASE_0_FINDINGS.md`, `MARKETING_CAPABILITY_LEDGER.md`,
`IMPLEMENTATION_PLAN.md`, `COPY_DECK.md`, `.env.example` (documented the two
new env vars)

## 3. QA performed for Phase 4

- **`tsc --noEmit`** — clean, whole repo.
- **`eslint .`** — clean, whole repo.
- **`next build`** — succeeds in both flag states.
- **Byte-identical-when-off**, verified against an actual `main`-branch build
  (not just code review) via a git worktree + two running servers, diffed:
  - `/`: both 307 → `/login`, identical redirect.
  - `/login`: HTML identical byte-for-byte except the shared CSS bundle's
    filename hash (Tailwind statically scans the whole repo, so new
    marketing-only utility classes get added to the global stylesheet even
    though `/login` never references them — a build artifact, not a
    behavioral change; confirmed by diffing the CSS content, which only adds
    new unused rules).
  - `/applications` unauthenticated guard: unchanged (307 → `/login`) in
    both branches.
  - `main` has no `/robots.txt` or `/sitemap.xml` routes at all — those paths
    fall through to the same catch-all unauthenticated redirect any unknown
    path gets. This branch adds them as real, self-gated routes (disallow-all
    / empty when the flag is off) — additive, not a regression.
- **Copy-vs-ledger drift audit** (fresh re-read of every `app/(marketing)/`
  component against `COPY_DECK.md` and `MARKETING_CAPABILITY_LEDGER.md`):
  no drift, no undocumented text, no zero-tolerance-list violations
  (no testimonials/ratings/counts/case studies/pricing/trial language).
  Jurisdiction badges (`Toronto`/`Calgary` = Verified, `Ottawa` = Assisted,
  `Hamilton` = Listed) render `components/coverage-badge.tsx`'s exact
  wording, not a re-typed copy.
- **Secret-leak check**: grepped the built client JS chunks for
  `SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY`,
  `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `INNGEST_SIGNING_KEY`,
  `INNGEST_EVENT_KEY` — zero matches in any chunk.
- **Metadata/JSON-LD validation** (live server, flag on): title, canonical,
  OG, and Twitter tags all correct; JSON-LD parses and contains only
  `Organization`/`WebSite` — no `AggregateRating`/`Review`/`offers`.
- **Nav anchors**: `#how-it-works` and `#coverage` links resolve to real
  `id` attributes on their target sections.
- **Regression check**: `/login` (200) and the `/applications` auth guard
  (307 → `/login`) both work identically with the flag on.
- **Responsive**: homepage uses mobile-first Tailwind utilities throughout
  (unprefixed base classes for mobile, `sm:` overrides at ≥640px — e.g.
  `text-4xl sm:text-5xl`, `grid` → `sm:grid-cols-3`), consistent with the
  rest of the app's existing responsive conventions.

## 4. One real bug found and fixed during QA (not by the user — self-caught)

`proxy.ts` was redirecting unauthenticated requests to `/robots.txt` and
`/sitemap.xml` to `/login`, making the new SEO files completely
uncrawlable in either flag state. Fixed with an unconditional allowlist
entry (both files already self-gate their own content, so this doesn't
weaken anything — see `proxy.ts`'s own comment). Included in commit
`d6a14b2`.

## 5. Operational notes for whoever flips the flag in production

1. **`/robots.txt` and `/sitemap.xml` are statically prerendered at *build*
   time**, not evaluated per-request. Confirmed directly: starting a server
   with `NEXT_PUBLIC_MARKETING_V2=true` against a build that was done with
   the flag `false` still served the *off* robots/sitemap content. `/` and
   its metadata are unaffected by this (they're server-rendered per
   request), but **turning the flag on requires an actual rebuild**, not
   just a runtime env var change — a non-issue on a normal Vercel deploy
   (env var changes there trigger a rebuild anyway), but worth knowing if
   anyone ever tries to toggle it by restarting a long-running Node process
   with a new env var in place.
2. **Vercel Web Analytics needs to be turned on in the Vercel dashboard**
   (Project → Analytics → Enable) before any data collects — the code change
   alone doesn't do this, and it's a dashboard/account setting outside what
   this delivery can do on your behalf. Confirmed the component itself
   correctly no-ops on non-Vercel/local environments rather than erroring.
3. **No OG image, no logo asset** — intentionally omitted; none exists yet
   and fabricating one would violate the ledger's anti-fabrication rule.

## 6. Known gaps carried forward (not blockers, not silently dropped)

- `NEXT_PUBLIC_SITE_URL` / production `site_url` (Supabase auth redirect
  config) was flagged in Phase 0/1 as unverifiable from the repo — still
  true, still not this branch's concern (no new auth redirects added).
- No consent/cookie banner was added — Vercel Web Analytics is
  cookieless, so this was judged not to require one, but that's a product
  decision, not a legal one; flag if that assumption is wrong for your
  jurisdiction.

## 7. Rollback

Set `NEXT_PUBLIC_MARKETING_V2=false` (or leave unset — same default) and
rebuild. Confirmed in §3 that this restores byte-identical prior behavior.
