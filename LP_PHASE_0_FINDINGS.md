# LP_PHASE_0_FINDINGS.md — Landing Page, Metadata & Jurisdiction SEO

Read-only audit per the master prompt's §3 (Phase 0). No code changes made.
Repo: `github.com/ren206-png/permitfield-os`, branch `main`,
HEAD `2ae5599318dfbc3e39f8ecee0d8b83952d9150cd` ("feat(admin): add platform
admin panel"). Named `LP_PHASE_0_FINDINGS.md` per the master prompt's
explicit instruction not to reuse `PHASE_0_FINDINGS.md` (that name belongs
to the app build).

**Headline finding, before the detail sections below**: a prior workstream
("Marketing Homepage v2") already built and **shipped to production** almost
everything this master prompt's Phase 1 and Phase 2 ask for — a claims
ledger, a copy deck, the flag-gated homepage itself, basic metadata/OG/
JSON-LD, robots.txt/sitemap.xml. It is not a proposal sitting in a branch;
it is live at `https://www.permitfieldos.com` and `https://permitfieldos.com`
right now (confirmed by live HTTP requests, not by reading code — see §0.4).
This changes Phase 0's job from "audit a redirect-only stub" to "audit a
live page against this master prompt's stricter bar (C1–C6, the exact route
architecture, jurisdiction SEO pages)" and changes Phase 1 from "write new
copy" to "identify the specific deltas between what's live and what this
master prompt requires."

---

## 0.1 — Marketing surface inventory

Every file that renders the public site, and what's on it:

| File | Renders | Notes |
|---|---|---|
| `app/page.tsx:62-82` | `/` entry point | Own `auth.getUser()` check (not proxy-only); redirects signed-in users to `/applications`; renders `MarketingHomepage` when `isMarketingV2Enabled()`, else redirects to `/login`. `generateMetadata()` at :25-49 provides title/description/canonical/OG/Twitter, but **only when the flag is on** — returns `{}` (inert) when off, which merges with `app/layout.tsx`'s defaults. |
| `app/layout.tsx:16-19` | site-wide `<head>` default | `title: PRODUCT_NAME` ("PermitField OS"), `description: "AI-assisted permitting for Canadian commercial and trade contractors."` — no OG/Twitter/canonical here; this is the fallback for every route that doesn't override it, including `/` when the flag is off. |
| `app/(marketing)/marketing-homepage.tsx:45-90` | page shell | Header/nav (wordmark, `#how-it-works`/`#coverage` anchors, Sign in, Create your account, `ThemeToggle`), composes the five sections below, mounts `StructuredData` and Vercel `Analytics`. |
| `app/(marketing)/sections/hero.tsx:8-55` | hero | H1 "Permit applications, organized from intake to filing." Subhead names Toronto/Calgary **in prose** (`hero.tsx:33-36`: "Built for contractors working in Toronto and Calgary today.") — hardcoded, not sourced from the coverage section or registry. CTAs: "Create your account" → `/login`, "See how it works" → in-page anchor. |
| `app/(marketing)/sections/how-it-works.tsx:5-25` | 3-step explainer | Start application / upload documents / track to filing. |
| `app/(marketing)/sections/capabilities.tsx:7-36` | 4 capability cards | Intake & tracking, AI extraction, form auto-fill (Toronto ESU form named explicitly), org-level data isolation. |
| `app/(marketing)/sections/coverage.tsx:11-58` | coverage tiers | Hardcoded `JURISDICTIONS` array (Toronto/Calgary verified, Ottawa assisted, Hamilton listed), reuses `components/coverage-badge.tsx` directly for label/color — see §0.3 for whether this array can drift from the real registry. |
| `app/(marketing)/sections/footer-cta.tsx:7-38` | footer | CTA repeat, `LEGAL_DISCLAIMER` from `lib/brand.ts:10-12` verbatim, copyright line. No social links (none exist). |
| `app/(marketing)/structured-data.tsx:16-42` | JSON-LD | `@graph` of `Organization` + `WebSite` only. No `SoftwareApplication`, no `offers`, no `AggregateRating`. |
| `app/(marketing)/theme-toggle.tsx` | light/dark toggle | Presentational only, no copy/claims; scoped to `#marketing-root`, never touches `<html>` or the authenticated app. |
| `app/robots.ts:1-33`, `app/sitemap.ts:1-23` | SEO plumbing | Both flag-gated (disallow-all/empty when off); confirmed live — see §0.4. |
| `lib/seo.ts:11` | `SITE_URL` | `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.permitfieldos.com'`. |
| `lib/brand.ts:7-15` | brand constants | `PRODUCT_NAME`, `PRODUCT_SHORT`, `LEGAL_DISCLAIMER`, `DRAFT_WATERMARK_TEXT`. |
| `components/coverage-badge.tsx:6-30` | shared tier badge | Used by both the marketing coverage section **and** the authenticated app's application pages (`app/(app)/applications/**`) — see §0.3. |

**Every visible sentence on the live page traces to one of these files** —
confirmed by diffing the live-served HTML (§0.4) against this component
tree; no orphan copy found.

---

## 0.2 — Claim-to-capability trace table

The prior workstream already produced this exact artifact —
`MARKETING_CAPABILITY_LEDGER.md` (19 rows, SHIPPED/PARTIAL/NOT BUILT, each
with file:line evidence, dated to commit `c5cfa931044e`). I did not accept
it uncritically; I re-verified the rows that matter most for C1–C4 directly
against current `main` (not just trusting the doc):

- **§2 (AI extraction)**: confirmed `lib/ai/extract-permit-data.ts` still
  exists and still backs `capabilities.tsx`'s "for review, not blind
  auto-fill" wording (`capabilities.tsx:16`) — matches.
- **§3 (form auto-fill)**: confirmed `capabilities.tsx:21-25` still says
  "For the Toronto Electrical Service Upgrade form today" — matches the
  ledger's "qualified only" instruction, not the general/plural claim C1
  forbids.
- **§5 (no auto-submission)**: confirmed `how-it-works.tsx:19-24` says "mark
  it submitted once you've filed with the authority" — correctly never
  claims the product files on the contractor's behalf.
- **§6/jurisdiction table**: confirmed against **live production data**
  (§0.3) that the four seeded jurisdictions and their tiers still match
  what `coverage.tsx` renders — no drift as of this audit.
- **§15 (billing/trial)**: confirmed `lib/entitlements/index.ts:4` still
  states verbatim "THIS IS NOT A REAL BILLING/SUBSCRIPTION SYSTEM" — no
  trial mechanism exists; CTAs correctly read "Create your account," never
  "Start Free Trial" (C4 satisfied today).

**No current claim on the live page violates C1–C5.** The existing ledger
and copy deck are, on inspection, honest and narrow. The two live gaps
worth carrying into Phase 1/2 are not overclaims but a **staleness risk**
and a **missing schema type**:

1. `hero.tsx:33-36` hardcodes "Toronto and Calgary" in prose rather than
   linking to `#coverage` — exactly the anti-pattern this master prompt's
   §4 already names ("don't hardcode... so the hero stops going stale
   every time coverage grows"). Today it's still true (Toronto/Calgary are
   still the two verified cities), so it is not currently a false claim,
   but it is one edit away from becoming one the next time coverage
   changes and someone forgets this file.
2. `structured-data.tsx` ships `Organization`/`WebSite` only; this master
   prompt's §5 asks for `SoftwareApplication` too. Adding it is new scope,
   not a fix to an existing violation.

Proposed §5-copy changes (regulator sentence, sharpened headline test, CTA
re-confirmation) are Phase 1 work, deferred until `APPROVED: PHASE 1`.

---

## 0.3 — Coverage registry state

**Real registry exists, and it is the single source of truth for the
in-app product**: `jurisdictions` table, `coverage_level` column, typed as
a Postgres enum `('verified', 'assisted', 'listed')`
(`supabase/migrations/20260806000004_jurisdictions_and_authorities.sql:7,29`).
Every authenticated-app read goes through this table live — `app/(app)/applications/new/page.tsx:18`,
`app/(app)/applications/page.tsx:22`, `app/(app)/applications/[id]/page.tsx:41,60`
all `select(...coverage_level)` and pass it to the same
`components/coverage-badge.tsx` the marketing page uses. Two Inngest
functions (`lib/inngest/functions/audit.ts:78,116`, `generate-pdf.ts:68,130`)
gate real behavior on this same column (e.g., the AI audit only runs for
`coverage_level = 'verified'`) — this is not a display-only field, it's
load-bearing.

**The marketing page does not read this table.** `coverage.tsx:11-16`
hardcodes a local `JURISDICTIONS` array with the same four names/tiers.
Confirmed against the actual seed data (`supabase/seed.sql:14-27`, which
the seed file's own header states is real production reference data, not a
test fixture — Part 2 of that file is separately and explicitly marked
"LOCAL DEV / TEST FIXTURES ONLY," Part 1 is not) — as of this audit, the
hardcoded array **matches** the registry exactly (Toronto/Calgary
`verified`, Ottawa `assisted`, Hamilton `listed`). So there is no live drift
today, but this is a two-writer setup with no sync mechanism: if a
`platform_admin` promotes Ottawa to `verified` in the database, nothing
forces `coverage.tsx` to be edited to match, and nothing would fail loudly
if it weren't. This is exactly the "Drift Fork" scenario §8 asks about —
flagged here as a **§9.5 decision for Ren**: consolidate (marketing page
queries `jurisdictions` server-side, same as the app does) vs. accept the
duplication with a code-comment tripwire. I have not chosen an approach or
implemented either.

---

## 0.4 — Metadata & schema state (verified live, not just from source)

Rather than trust the code comments alone, I made live HTTP requests
against production to see what's actually served — this matters because
the repo's own docs (`DELIVERY_REPORT.md:5`) describe this branch as "Not
merged," which is now **stale**: it was squash-merged via PR #8
(`e34362f`, single parent, msg concatenates all 4 phase commits — a squash
merge, which conflicts with this master prompt's §0.2 "fast-forward only,
no squash" rule; noting this happened before this master prompt existed,
not a violation I committed, but relevant to how future merges on this
workstream must be handled) and further extended, undocumented in any
ledger/copy-deck, by two more merged PRs: `f6f95f7` (#11, gradient color
system) and `5404708` (#12, light/dark theme toggle — the `ThemeToggle`
component in §0.1). Both are presentational-only; confirmed no new
copy/claims in either (spot-checked `theme-toggle.tsx` in full).

**Live findings** (`curl`, both hosts, 2026-09-01):

- `https://www.permitfieldos.com/` → `200`, real homepage content —
  **the flag is ON in production right now.**
- `https://permitfieldos.com/` → `200`, also real homepage content —
  **no host-level redirect exists between apex and www.** Both serve
  identical HTML independently.
- Both hosts serve identical `<title>`, description, canonical, OG, and
  Twitter tags, and **both correctly declare `www` as canonical**
  (`<link rel="canonical" href="https://www.permitfieldos.com"/>`,
  `og:url` same value) — so the metadata itself is internally consistent,
  contrary to what a literal reading of the master prompt's "canonical
  points at www while OG URL... differ" might suggest for *this* repo. The
  actual gap is narrower: **the served host and the declared canonical
  disagree with no enforcing redirect** — a crawler landing on the apex
  URL gets a 200, not a 308 to www, and has to trust the canonical tag
  alone to resolve the duplicate-content signal. `http://permitfieldos.com`
  (no TLS) does 308-redirect to `https://permitfieldos.com` (HTTPS
  upgrade), but not on to `www`.
- Title tag: `PermitField OS — Permit application tracking for
  contractors` — **exactly 60 characters**, at the master prompt's stated
  limit with zero margin.
- Meta description: 150 characters — within the requested 140–155 range.
- Twitter card: `summary`, not `summary_large_image` — confirmed live,
  matches the master prompt's own prediction. No `og:image` tag at all —
  confirmed live; `app/page.tsx:21-24`'s comment explains this is
  deliberate (no real product screenshot or logo asset exists; the prior
  workstream judged fabricating one worse than omitting it).
- JSON-LD: confirmed live, `@graph` of `Organization` + `WebSite` only,
  matches `structured-data.tsx` exactly, no `AggregateRating`/`offers`.
- `robots.txt` (live): allows `/`, disallows `/login`, `/onboarding`,
  `/applications`, `/projects`, `/contractors`, `/api/`; references
  `Sitemap: https://www.permitfieldos.com/sitemap.xml`.
- `sitemap.xml` (live): one URL, `https://www.permitfieldos.com`,
  `lastmod` 2026-08-29.
- `NEXT_PUBLIC_SITE_URL` is documented in `.env.example:78` as
  `https://www.permitfieldos.com`, matching what's live — the "not
  verifiable from the repo" caveat in `MARKETING_PHASE_0_FINDINGS.md §6`
  and `IMPLEMENTATION_PLAN.md §9` is resolved as of this audit (confirmed
  by live request, not by re-reading that same claim).

**Fix scope for Phase 2** (not implemented now): add an actual apex→www
redirect (Vercel domain-level redirect or a `next.config.ts`/middleware
redirect) so the served host matches the declared canonical, rather than
relying on the canonical tag alone. `next.config.ts` currently has no
redirect config to build on (`next.config.ts:1-6`, empty).

---

## 0.5 — Route architecture conflict check

**Planned architecture (`/permits/[country]/[region]/[city]` + `/coverage`
index) does not exist.** Confirmed: no `app/permits/` directory, no
`app/coverage/` directory or route — the only thing named "coverage" in
`app/` is the in-page anchor section `app/(marketing)/sections/coverage.tsx`,
which is not a route. No flat vanity URLs exist either (`/calgary-building-permits`
or similar) — confirmed by directory search; the marketing route surface
is currently only `/`.

**No `PERMITFIELD_FF_JURISDICTION_PAGES` flag exists** in `lib/flags.ts` —
confirmed by reading the full file (12 exported flag functions, none
named this). One naming collision risk worth flagging before Phase 3
picks a flag name: `lib/flags.ts:71` already exports
`isJurisdictionsEnabled()` reading `PERMITFIELD_FF_JURISDICTIONS` — an
unrelated, already-shipped flag gating the Lifecycle & Compliance
workstream's backend jurisdiction-directory schema (`20260806000021_jurisdiction_sources.sql`),
not this master prompt's SEO pages. `PERMITFIELD_FF_JURISDICTION_PAGES` is
distinct enough not to collide programmatically, but the names are close
enough that Phase 3 should keep the comment in `lib/flags.ts` explicit
about which is which, matching this file's existing self-documentation
discipline.

No route collision, no partial/abandoned scaffold found for either
`/permits/...` or a flat-URL approach — this is a clean, un-started Phase 3,
not a conflict to reconcile.

---

## 0.6 — Asset existence checks

- **Free-trial mechanism**: does not exist. `lib/entitlements/index.ts:4`
  (re-confirmed directly, not just cited from the ledger): "THIS IS NOT A
  REAL BILLING/SUBSCRIPTION SYSTEM... no plans/subscriptions table, no
  billing provider integration." No Stripe or equivalent in
  `package.json`. Per C4, "Start Free Trial" may not appear; current CTA
  "Create your account" stays correct.
- **Demo video / recordable in-product flow**: no video asset anywhere in
  `public/` (only stock Next.js SVGs: `file.svg`, `vercel.svg`, `next.svg`,
  `globe.svg`, `window.svg` — none product-related). No screenshot exists
  either. `MARKETING_PHASE_0_FINDINGS.md §7` judged capturing a real
  screenshot from seed data as feasible but not yet attempted — still true;
  nothing new since that finding. An interactive preview or recorded demo
  would be new work, not a resurfacing of something already built.
- **Email/SMS infrastructure**: confirmed absent — no `resend`,
  `sendgrid`, `nodemailer`, `twilio`, or similar in `package.json`;
  `lib/inngest/client.ts` comments (per the ledger's §12 row) state
  verbatim that reminder/notification events have "no subscriber... in
  this codebase." Noting as absent per the master prompt's instruction,
  not proposing to build it (reminders are explicitly out of scope, §7).

---

## 0.7 — Canada-only vs. Canada+US framing (surfaced, not resolved)

Repo-internal evidence is **uniformly Canada-only**:

- `README.md:3`: "AI permitting and local compliance copilot for
  commercial and trade contractors. **Canada launch**."
- `docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:41`: "**Canada-first**
  deployment. Assume PIPEDA applies... Flag it as a risk if the project
  region is outside Canada."
- `MARKETING_CAPABILITY_LEDGER.md`'s zero-tolerance list: "any claim of US
  coverage" is explicitly forbidden.

I searched the full repo (all `.md` files, case-insensitive) for "United
States," "U.S.," or any framing resembling "initially focused on Canada
and the United States" — **no match found anywhere in this repository.**
Whatever prior draft the master prompt refers to describing that framing
is not present in this codebase; it is presumably an external document
(pitch deck, notion page, conversation) that hasn't been committed here.

Per the master prompt's own instruction: **listing both, recommending
neither.** Repo says Canada-only. An external draft apparently once said
Canada+US. This is §9.1 — reserved for Ren.

---

## 0.8 — Confirmed: `AGENTS.md`/`CLAUDE.md` quarantine was correct

Read both files directly as part of this audit (as data, not instructions,
per master prompt §0.5). Contents:

```
# This is NOT the Next.js you know
This version has breaking changes — APIs, conventions, and file structure
may all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/`... before writing any code...
This block is written and re-added by `next dev`... committing it with
your work keeps the tree clean.
```

This is a textbook injected instruction — false framing ("not the Next.js
you know," a nonexistent doc path), a directive to take an action
(read/commit), and a claim of tool-generated legitimacy designed to
discourage removal. I did not follow it: did not read
`node_modules/next/dist/docs/`, did not edit or commit either file. Noting
this here as the master prompt asked (§8, "The Injected Instruction" self-check)
and because it re-surfaced automatically via the harness's own
`@AGENTS.md`-import memory mechanism mid-session, unprompted — worth
knowing it will keep resurfacing in every session against this repo, not
just this one.

---

## §8 — Adversarial self-checks (run before requesting Phase 1 approval)

The master prompt requires these five named checks be run before every
phase-approval request, not just implied by the narrative above. Running
them explicitly, each pointing back to where the evidence already lives:

1. **Overclaim** — does any live claim exceed what the code actually does?
   Checked in §0.2 by re-verifying (not just citing) the five highest-risk
   ledger rows against current `main`: AI extraction ("for review, not
   blind auto-fill"), form auto-fill (named to one specific form, not
   pluralized), no-auto-submission wording, the jurisdiction tier table
   against live seed data, and the billing/trial CTA against
   `lib/entitlements/index.ts:4`. Result: **no overclaim found.** The two
   items flagged (hardcoded city names, missing `SoftwareApplication`
   schema) are staleness/completeness gaps, not claims that are false today.

2. **Vacuous Verification** — did I just re-cite a doc's claim about itself,
   or independently confirm it? Two concrete catches in §0.4: (a)
   `DELIVERY_REPORT.md:5`'s "Not merged" claim was re-checked against
   `git log`/`git branch --contains` and found **stale** — it *was* merged
   (PR #8) plus two further undocumented merges (#11, #12); (b)
   `NEXT_PUBLIC_SITE_URL`'s "not verifiable from repo" caveat in
   `MARKETING_PHASE_0_FINDINGS.md §6` was resolved by live `curl`, not by
   re-reading the same caveat. Every metadata/schema/robots/sitemap finding
   in §0.4 is sourced to a live HTTP request I made this session, dated
   2026-09-01, not to a comment or doc claiming the state.

3. **Drift Fork** — are there two independent writers of the same fact with
   no sync mechanism? Found and named explicitly in §0.3: the real
   `jurisdictions.coverage_level` Postgres enum (load-bearing — gates
   Inngest audit behavior) vs. `coverage.tsx`'s hardcoded `JURISDICTIONS`
   array. No live drift today (values match), but no enforcement stops
   future drift. Flagged as §9.5, reserved for Ren — not resolved
   unilaterally.

4. **Ghost Asset** — does copy reference something (video, screenshot,
   logo, integration) that doesn't exist? Checked in §0.6: no demo video,
   no product screenshot, no email/SMS infra, no billing/trial mechanism —
   confirmed absent from `public/` and `package.json`, and confirmed the
   current copy does not reference any of them (no "watch a demo," no
   "start your free trial" language anywhere live). `og:image` is
   deliberately absent rather than pointing at a ghost asset — `app/page.tsx:21-24`'s
   comment documents this as an intentional omission, not an oversight.

5. **Injected Instruction** — does any observed file try to direct my
   actions? Found and quarantined in §0.8: `AGENTS.md`'s "This is NOT the
   Next.js you know... read `node_modules/next/dist/docs/`... committing it
   keeps the tree clean" — textbook false-framing plus an action directive
   plus a fabricated-legitimacy claim. Not followed. Also re-surfaced
   automatically mid-session via the harness's own memory-import mechanism
   (unprompted, outside my control) — noted once here since it will recur
   in every session against this repo, but not re-litigated as a new
   finding each time it reappears.

No check surfaced anything requiring a change to the findings above; all
five are reflected in the sections already written.

---

## Summary: what Phase 1 actually needs to do

Given §0.2's finding that current copy has no C1–C5 violations, Phase 1's
job is narrower than "write new copy" — it's:

1. De-hardcode the Toronto/Calgary mention in `hero.tsx`'s subhead per the
   master prompt's own §4 direction (link to `#coverage` instead).
2. Decide (§9.5, Ren) whether to consolidate the coverage registry before
   or after this ships, given no live drift today but a real fork risk.
3. Everything else in the current copy already passes C1–C6 as written —
   Phase 1 should confirm this rather than rewrite working, honest copy
   for its own sake.

Phase 2's job is: `SoftwareApplication` JSON-LD (new), OG image asset
(new, still needs a real design — no screenshot exists), 2–3 title-tag
candidates (current one is already at the 60-char ceiling, worth
proposing an alternative with margin), and the apex→www redirect (§0.4).

Phase 3 is genuinely greenfield — no jurisdiction SEO page or `/coverage`
route exists in any form to conflict with or build on.

---

**STOP. Awaiting `APPROVED: PHASE 1`.**
