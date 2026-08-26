# Phase 0 Findings — PermitField OS Marketing Homepage

Read-only repository audit for the Marketing Homepage build (master prompt v2, phase-gated).
No application code, schema, or config was modified. No dependencies were installed.

**Filename note (conflict flagged, resolved non-destructively, same pattern as this repo's
existing precedent in `PHASE_0_FINDINGS.md:5-16`):** the master prompt asks for this deliverable
at `PHASE_0_FINDINGS.md`. That filename is already occupied — and already git-committed — by an
earlier, unrelated "Lifecycle & Compliance Expansion" audit (`git log --oneline -- PHASE_0_FINDINGS.md`
shows it dates back to the `Initial commit` and multiple Gate 1.x commits). Overwriting a committed
file that other docs (`README.md`, `GATE_2_0_FINDINGS.md`, `supabase/seed.sql` comments) cite by
that exact name would be destructive and would break those cross-references. Resolution: this
deliverable is filed as `MARKETING_PHASE_0_FINDINGS.md`, and its companion ledger as
`MARKETING_CAPABILITY_LEDGER.md`, both at repo root. No existing content was touched, renamed, or
deleted.

**Branch:** `feat/marketing-homepage-v2` (created off `main`, which was clean at branch time).

---

## 1. Stack & Architecture

- **Framework:** Next.js `16.3.0` (`package.json:21`), App Router (`app/` directory; route group
  `app/(app)/` for authenticated pages, `app/(app)/layout.tsx:15`).
- **Runtime:** React `19.2.8` / `react-dom` `19.2.8` (`package.json:24-25`). TypeScript `^5`
  (`package.json:38`), `"strict": true` (`tsconfig.json:7`), `noEmit: true` — typecheck is
  `npx tsc --noEmit`, no dedicated `typecheck` script in `package.json`.
- **Middleware convention:** this Next major version renamed `middleware.ts` to `proxy.ts`; this
  repo has already made that migration and the file documents why at `proxy.ts:4-6`, citing
  `node_modules/next/dist/docs/...proxy.md` and this repo's own `AGENTS.md`. **Any new
  routing/auth work must edit `proxy.ts`, not `middleware.ts`.**
- **Styling:** Tailwind CSS `^4` via `@tailwindcss/postcss` (`package.json:29,36`,
  `postcss.config.mjs:1-5`, minimal, no extra plugins). No `tailwind.config.ts` exists — Tailwind 4
  is running on defaults plus the tiny `@theme inline` block in `app/globals.css:8-12`.
- **Design tokens today:** exactly four CSS variables in `app/globals.css:3-12` — `--background`,
  `--foreground` (light `#ffffff`/`#171717`, dark `#0a0a0a`/`#ededed` via
  `prefers-color-scheme`, `app/globals.css:14-18`), plus font variables. Everything else is
  Tailwind's stock `zinc-*` palette hard-coded per component (e.g. `app/(app)/layout.tsx:19-54`:
  `bg-zinc-50`, `border-zinc-200`, `text-zinc-900`).
- **Component library:** none. Two components total in the whole repo:
  `app/components/coverage-badge.tsx`, `app/components/status-badge.tsx` — both narrow,
  domain-specific, not reusable marketing primitives.
- **Bug found in passing:** `app/globals.css` sets `body { font-family: Arial, Helvetica,
  sans-serif; }`, which overrides the Geist font CSS variables set up two lines earlier. The Geist
  font is loaded (`app/layout.tsx:2,6-14`) but never actually applied to `<body>`. Worth a one-line
  fix in Phase 2 (additive, not a rewrite) so the marketing page doesn't render in Arial by
  accident.
- **Deployment target:** no `vercel.json` in the repo (deployment config lives in the Vercel
  dashboard, not in-repo — confirmed separately in this conversation's earlier DNS/deploy work).
  `next.config.ts:1-7` is a near-empty stub: no `images.domains`/`remotePatterns`, no `redirects`,
  no CSP headers, no CDN/caching config. Any remote images the marketing page wants will need an
  explicit `images` block added (additive change).
- **Edge runtime:** not used anywhere (`export const runtime = 'edge'` — zero hits). All routes run
  Node.js by default, which is fine for a marketing page.

## 2. What Exists Today at `/`

- **`app/page.tsx:1-10`** is a pure redirect, not a page:
  ```ts
  export default function RootPage() {
    redirect('/applications');
  }
  ```
  Its own comment (`app/page.tsx:3-7`) states this plainly: `proxy.ts` already turns away every
  unauthenticated request before this component renders, and there's no "dashboard at root"
  concept in the product — `/applications` is the one home screen. **There is no existing
  marketing content anywhere in the repo to preserve or migrate.**
- **No marketing components exist** — nothing named `marketing*`, no landing-page primitives.
- **No i18n / locale routing** — no `next-intl`, no `[locale]` segments. English only.

## 3. Brand & Design System

- **Logo:** does not exist. `public/` contains only the stock Next.js scaffold SVGs (`file.svg`,
  `vercel.svg`, `next.svg`, `globe.svg`, `window.svg`) — no PermitField-branded logo in any format,
  light or dark. **This blocks the nav/hero logo requirement in the master prompt's §3.1 until a
  logo asset is supplied or commissioned — flagging now, not building one myself.**
- **Fonts:** `Geist` and `Geist_Mono` via `next/font/google` (`app/layout.tsx:2,6-14`), wired to CSS
  variables (`app/globals.css:8-12`) — see the Arial override bug noted above.
- **Color tokens:** no branded palette. Only light/dark `background`/`foreground` variables exist;
  everything else is Tailwind's default `zinc-*` scale, hard-coded per usage site, not sourced from
  a shared token file.
- **Verdict: ad-hoc, not a coherent design system.** Phase 1 should propose a small token set (CSS
  variables consumed by `@theme inline`, per master prompt §6) rather than either (a) inventing a
  parallel style system or (b) inheriting the bare `zinc-*` defaults wholesale, which would look
  generic.
- **Brand strings:** `lib/brand.ts:1-15` centralizes `PRODUCT_NAME = 'PermitField OS'`,
  `PRODUCT_SHORT = 'PermitField'`, a `LEGAL_DISCLAIMER` constant, and a draft watermark string.
  Good precedent — marketing copy should import `PRODUCT_NAME`/`PRODUCT_SHORT` from here rather
  than hard-coding the name again. No tagline, hero copy, or feature descriptions exist yet; all
  of that is genuinely new copy to be written in Phase 1's `COPY_DECK.md`.

## 4. Auth, Billing, Trial

- **Signup is real and self-serve, live today, not waitlisted.** `app/login/login-form.tsx` has a
  Sign in / Create account tab switcher; account creation calls
  `supabase.auth.signUp({ email, password })` (`app/login/login-form.tsx:33`).
- **Email verification is explicitly disabled:** `supabase/config.toml:226` sets
  `enable_confirmations = false` under `[auth.email]`; `app/login/login-form.tsx:27-29`'s own
  comment confirms this is intentional ("no OAuth providers enabled, email confirmation off").
  Signup logs the user in immediately.
- **No billing system exists — none at all.** No Stripe/Paddle/Lemon Squeezy or any billing
  provider anywhere in the dependency tree or code. `lib/entitlements/index.ts:1-21` says this
  outright, in block-comment caps: *"THIS IS NOT A REAL BILLING/SUBSCRIPTION SYSTEM"* — confirming
  no plans table, no subscriptions table, no provider integration exists anywhere in the codebase.
  Every org is simply granted one hardcoded `DEFAULT_TIER` on creation
  (`lib/entitlements/index.ts:79-100`) with a 50-active-project ceiling
  (`lib/entitlements/index.ts:89`) and no expiry, no card, no payment step of any kind.
- **No free trial mechanism exists.** No trial-duration field, no trial-expiry gate, no card
  requirement anywhere in the schema or code.

**Direct consequence for copy:** "Start Free Trial" as a CTA label is misleading (it implies a
time-boxed trial that converts to paid, and implies a card may eventually be required) when the
actual product is "create an account and use it, free, indefinitely, up to a soft 50-project org
cap." §3.2 of the master prompt permits "No credit card required" **only if §2.4 confirms it** —
it's confirmed (no card is ever asked for) but the phrase would be true for the wrong reason (there
is no paid tier to contrast it against, not "we trust you enough to skip the card check"). This is
a judgment call for Phase 1's copy deck, not something to resolve unilaterally here: options are
(a) "Get Started Free" instead of "Start Free Trial", or (b) keep "Start Free Trial" only if Ren
confirms a trial-then-paid model is coming before launch. **Flagging for Phase 1 approval, not
deciding now.**

## 5. Analytics

- **No analytics provider integrated anywhere** — no PostHog, Segment, GA4, Vercel Analytics, or
  Plausible in `package.json` or in `app/layout.tsx`/providers.
- **No existing event-naming convention** to match, because nothing emits events today. The
  `'analytics'` string in `lib/entitlements/index.ts` is a feature-gate key for dashboard access,
  not a telemetry system — unrelated to marketing analytics.
- Master prompt §7.3 says "instrument using the *existing* provider" and "do NOT plan to add a
  second provider" — since there is no first provider, Phase 1 needs to either (a) get explicit
  sign-off to add exactly one lightweight provider (e.g. Vercel Analytics, since the app already
  deploys there), or (b) ship without analytics instrumentation and note it as a gap in the
  delivery report. **Flagging for Phase 1 decision, not deciding now.**

## 6. SEO Baseline

- **Root metadata only**, and it's generic: `app/layout.tsx:16-19`
  ```ts
  export const metadata: Metadata = {
    title: PRODUCT_NAME,
    description: "AI-assisted permitting for Canadian commercial and trade contractors.",
  };
  ```
  No `openGraph`, no `twitter`, no `canonical`, no `keywords`, no route-level
  `generateMetadata()` anywhere else in the tree.
- **`sitemap.ts` and `robots.ts` do not exist.** Both need to be created in Phase 3, per the master
  prompt's requirement that they derive from one shared indexability function (§7, §8).
- **Favicon:** only the stock Next.js `app/favicon.ico`. No `app/icon.tsx`, no `app/apple-icon.tsx`,
  no modern OG-image route.
- **No `noindex` anywhere today** — nothing to conflict with.
- **No staging domain leakage found.** `.env.example` and `.env.local` reference only
  `localhost:54321`/`54322` (local Supabase ports), not a staging hostname.
  `supabase/config.toml:159` hardcodes `site_url = "http://127.0.0.1:3000"` for local auth
  redirects — fine for local dev, but Phase 3 should confirm the production Supabase project (the
  live `PermitField-os` project this conversation set up on Vercel) uses the real
  `permitfieldos.com` site URL, not this local value, before shipping. Note: this repo's local
  `.env.local`/`supabase/config.toml` are separate from the Vercel production environment
  variables already configured in this conversation's earlier work — this is a repo-local dev
  config, not what's actually live at `permitfieldos.com`.

## 7. Product Visuals Feasibility

- **No real screenshots exist anywhere in the repo.**
- **The app can run locally with realistic seed data.** `supabase/seed.sql` seeds two demo
  contractor orgs ("Org A - Test Mechanical Ltd.", "Org B - Test Electrical Inc.", fictional
  license numbers) and four jurisdictions (Toronto, Calgary, Ottawa, Hamilton) with sample permit
  applications. This is sufficient, per master prompt §5 priority order, to capture a **real**
  screenshot of the running app with obviously-synthetic demo data (fictional org/project names) —
  this is the correct visual path, not a hand-built mockup. Feasibility: **yes**, contingent on
  `npm run dev` + local Supabase being runnable in Phase 2 (not yet attempted in this read-only
  phase).

## 8. Risks

- **CRITICAL — `proxy.ts` will block a public marketing page at `/` outright.** The matcher
  (`proxy.ts:69-75`) is `'/((?!api|_next/static|_next/image|favicon.ico).*)'`, which matches `/`.
  The redirect logic (`proxy.ts:55-58`) sends **any unauthenticated request to any non-`/login`
  path** — including `/` — straight to `/login`. Today `app/page.tsx` papers over this by never
  needing to be reached unauthenticated (the proxy already turned the request away). A new public
  homepage at `/` would never render for a logged-out visitor without a change to `proxy.ts` — this
  is the single largest blocker and needs explicit handling in Phase 1's `IMPLEMENTATION_PLAN.md`
  (most likely: add an explicit public-path allowlist check before the redirect, e.g. exempting
  `/` and any other future public marketing routes, and being careful to keep `/api` and all
  authenticated `(app)` routes fully protected as they are today).
- **No route collisions.** Confirmed nothing exists yet at `/solutions`, `/pricing`, `/resources`,
  or `/permits` — safe to add nav links pointing at these once the pages exist (per master prompt
  §3.2, only link to pages that will exist by launch).
- **No CSP headers configured** anywhere (`next.config.ts`, `proxy.ts`) — nothing to violate today,
  but also nothing enforcing script-src discipline; worth keeping in mind if any third-party embed
  is ever considered (master prompt already forbids adding new vendors).
- **`next/og` is available for OG-image generation** without any new dependency — it ships inside
  Next.js 16, just unused today.

## 9. Verdict Table

| File/Area | Verdict | Reason |
|---|---|---|
| `app/page.tsx` | **MODIFY** (behind flag) | Currently a pure redirect with no marketing content to preserve; becomes the flagged homepage entry point. |
| `app/layout.tsx` | **KEEP**, minor **MODIFY** | Font/metadata scaffolding is sound; will need `openGraph`/`canonical` additions in Phase 3, additive only. |
| `proxy.ts` | **MODIFY** | Must allowlist public marketing paths before the auth redirect fires — see Risk above. Highest-care edit in this project; must not weaken protection on any `(app)` or `/api` route. |
| `next.config.ts` | **MODIFY** (additive) | Needs `images` config only if remote images are used; currently safe/empty. |
| `app/globals.css` | **MODIFY** (additive) | Fix the Arial-override bug; add marketing design tokens as new CSS variables, don't replace existing ones. |
| `lib/brand.ts` | **KEEP**, extend | Good home for new marketing copy constants (tagline etc.) alongside the existing `PRODUCT_NAME`/`PRODUCT_SHORT`. |
| `components/` (`app/components/`) | **DO NOT TOUCH** | `coverage-badge.tsx`/`status-badge.tsx` are unrelated app-domain components; new marketing components go in their own new directory per master prompt §6. |
| `supabase/seed.sql` | **DO NOT TOUCH** | Read-only source for a real product screenshot; no reason to modify for this task. |
| `package.json` | **KEEP** | No new dependency currently justified; master prompt's default is zero new dependencies. |

---

## 10. Geography / Coverage Resolution (master prompt §1)

Resolved from `supabase/seed.sql` and `README.md` (cross-checked by a separate capability audit,
see `MARKETING_CAPABILITY_LEDGER.md`): **exactly four jurisdictions are seeded, all in Canada**:

| Jurisdiction | Province | Coverage tier |
|---|---|---|
| Toronto | ON | `verified` |
| Calgary | AB | `verified` |
| Ottawa | ON | `assisted` |
| Hamilton | ON | `listed` |

There is no data for any jurisdiction outside these four. **The homepage must not claim
"nationwide," "all of Canada," or any broader coverage claim than these four named cities with
their tiers made explicit.** Per master prompt §1, the Coverage nav item should be **omitted**
(coverage is too thin to support a dedicated page/section at launch) — this is a Phase 1 copy-deck
decision to confirm with Ren, not decided unilaterally here.

---

## 11. Summary of Items Requiring a Phase 1 Decision (not resolved in Phase 0)

1. **"Start Free Trial" vs. "Get Started Free"** — no trial mechanism or paid tier exists today;
   copy must not imply one. (§4 above)
2. **Analytics provider** — none exists; need sign-off to add exactly one, or ship without.
   (§5 above)
3. **Logo asset** — does not exist in the repo; needs to be supplied before the nav/hero can render
   a real logo. (§3 above)
4. **`proxy.ts` public-path allowlist design** — the exact mechanism (allowlist vs. route-group
   split) should be spelled out in `IMPLEMENTATION_PLAN.md` and reviewed carefully given it touches
   the auth boundary for the whole app. (§8 above)
5. **Production `site_url`/env values** — confirm the live Supabase project's auth redirect config
   points at `permitfieldos.com`, not the local dev value found in this repo's `supabase/config.toml`.
   (§6 above)

Full capability-by-capability evidence, including the two most legally sensitive findings
(no automatic municipal submission, no live municipal status integration) is in the companion
document: **`MARKETING_CAPABILITY_LEDGER.md`**.

**End of Phase 0. Awaiting `APPROVED: PHASE 0` before proceeding to Phase 1.**
