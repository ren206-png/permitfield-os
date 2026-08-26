# IMPLEMENTATION_PLAN.md — Marketing Homepage v2

Phase 1 deliverable. No code changes in this phase — this is the plan Phase
2 will execute. Grounded entirely in `MARKETING_PHASE_0_FINDINGS.md` and
`MARKETING_CAPABILITY_LEDGER.md`. Every design choice below either cites the
master prompt directly or resolves one of the five decisions Phase 0 flagged
as needing explicit sign-off rather than a unilateral call.

## 1. Feature flag

**New flag: `NEXT_PUBLIC_MARKETING_V2`**, default OFF (absent/anything other
than the literal string `"true"` = off — same fail-safe parsing rule
`lib/flags.ts`'s `isEnabled()` already enforces for every other flag in this
repo).

- Repo convention is `PERMITFIELD_FF_*`, server-only env vars. This flag
  intentionally diverges to the master prompt's literal name
  (`NEXT_PUBLIC_MARKETING_V2`) because it must be `NEXT_PUBLIC_`-prefixed:
  it's read both server-side (`proxy.ts`, `app/page.tsx`) and needs to be
  inlinable if any client component ever needs it (e.g. a client-side nav
  toggle). Documented as an intentional divergence, same as every prior
  naming divergence already recorded in `lib/entitlements/index.ts`.
- Implementation: one new exported function in `lib/flags.ts`,
  `isMarketingV2Enabled()`, calling the existing generic `isEnabled()`
  helper — no new parsing logic, same file, same pattern every other flag
  in that file already follows.

## 2. The `proxy.ts` blocker (Phase 0 Risk #1)

Current behavior: any unauthenticated request to any path except `/login`
is redirected to `/login`, including `/`. This must change **only** when
the flag is on, and must be **byte-identical** when it's off.

Planned change (additive, single new condition):

```
const isPublicMarketingRoute = isMarketingV2Enabled() && pathname === '/';

if (!user && !isAuthRoute && !isPublicMarketingRoute) {
  redirect to /login   // unchanged existing branch
}
```

- When the flag is off, `isPublicMarketingRoute` is always `false`, so this
  condition is always identical to today's — zero behavior change,
  verified by diffing proxy output for representative paths with the flag
  off before/after.
- Scope is a single exact path (`/`), not a prefix or wildcard — no other
  route becomes public. Every other authenticated route, every API route,
  and `/login` itself keep their exact current behavior regardless of flag
  state.
- Authenticated users hitting `/` are unaffected by this change — the
  existing `user && isAuthRoute` branch doesn't apply to `/`, and
  `app/page.tsx`'s own redirect (below) continues to send them to
  `/applications`.

## 3. `app/page.tsx` (Phase 0 verdict: MODIFY)

Today this file unconditionally redirects to `/applications`, relying on
`proxy.ts` to guarantee only authenticated sessions ever reach it. Once
`proxy.ts` lets unauthenticated requests through for `/` (flag on only),
this file must gain its own auth branch:

```
export default async function RootPage() {
  const user = await getUser();          // existing Supabase server client pattern

  if (user) redirect('/applications');    // unchanged existing behavior

  if (isMarketingV2Enabled()) {
    return <MarketingHomepage />;         // new, additive
  }

  redirect('/login');                     // defensive fallback; unreachable
                                           // today since proxy.ts already
                                           // redirects this case, kept so
                                           // this file is correct standalone
}
```

With the flag off, an unauthenticated request never reaches this component
(proxy.ts still redirects it upstream), so the fallback branch is inert —
confirms byte-identical behavior end-to-end, not just at the proxy layer.

## 4. New files (all additive — nothing below replaces or deletes an existing file)

- `app/(marketing)/` route group housing the new homepage's presentational
  components, kept separate from `app/(app)/` (existing authenticated
  product routes) so there's no risk of an import accidentally pulling
  product-only code (e.g. anything touching `requireOrgContext()`) into a
  page that must render for anonymous visitors.
- `app/(marketing)/marketing-homepage.tsx` — the top-level component
  `app/page.tsx` renders when the flag is on. Composed of section
  components below.
- `app/(marketing)/sections/hero.tsx`, `how-it-works.tsx`,
  `capabilities.tsx`, `coverage.tsx`, `footer-cta.tsx` — one file per
  homepage section, each rendering only copy already approved in
  `COPY_DECK.md`, each citing back to its `MARKETING_CAPABILITY_LEDGER.md`
  row in a code comment so a future editor can't silently drift a claim
  away from its evidence.
- No new npm dependencies. Tailwind v4 (already installed, no config file
  needed per Phase 0 findings) covers all styling; `next/image` (built-in)
  covers any real screenshot Phase 2 embeds.

## 5. Existing files touched (both already flagged MODIFY in Phase 0's verdict table)

| File | Change | Why additive-safe |
|---|---|---|
| `proxy.ts` | +1 boolean, +1 condition term (§2 above) | Flag-gated; off-path is byte-identical |
| `app/page.tsx` | +1 auth check, +1 conditional render branch (§3 above) | Unreachable when flag is off |
| `lib/flags.ts` | +1 exported function, same pattern as existing 9 | Pure addition, no existing export touched |

Nothing under `app/(app)/`, `app/api/`, `lib/auth/`, `lib/entitlements/`,
any Supabase migration, or `middleware`/auth logic beyond the single
`proxy.ts` condition above is touched. No existing component
(`components/status-badge.tsx`, `components/coverage-badge.tsx`) is
modified — they belong to the authenticated product, not the homepage.

## 6. Logo / brand asset decision (Phase 0 open item #3)

No logo asset exists anywhere in the repo. Decision: ship a **text
wordmark** using `PRODUCT_NAME` from `lib/brand.ts` (`"PermitField OS"`),
styled as a logotype (font weight/tracking), not an invented icon or mark.
No placeholder image, no generic icon standing in for a "logo" — that would
read as a real asset to a visitor and isn't one. This can be swapped for a
real mark later without touching any copy or claim.

## 7. Trial / pricing language decision (Phase 0 open item #1)

`lib/entitlements/index.ts` confirms no billing or trial system exists.
Decision: no trial language anywhere ("Start Free Trial," "No credit card
required," any plan/pricing copy). CTA copy is **"Create your account"** /
**"Get started"**, pointing at the existing `/login` sign-up flow
(`app/login/login-form.tsx`'s real `supabase.auth.signUp()` path). See
`COPY_DECK.md` for exact button text.

## 8. Analytics decision (Phase 0 open item #2)

The master prompt itself scopes analytics to **Phase 3** ("technical SEO,
structured data, analytics"), not Phase 2. Decision: Phase 2 ships the
homepage with **zero** analytics instrumentation. No provider is chosen in
this plan — that choice (and its own privacy/consent-banner implications)
is deferred to Phase 3 where the master prompt already places it, not
decided unilaterally here.

## 9. Production `site_url` (Phase 0 open item #5)

Not verifiable from the repository — this is a Supabase dashboard/project
setting, not a file. Flagged as an action item for Ren to confirm before
Phase 2 ships live (it affects auth redirect URLs generally; it does not
block writing or flag-gating the homepage itself, since the homepage adds
no new auth redirect). Not a blocker for Phase 1 or Phase 2 development.

## 10. Copy grounding

Every sentence of homepage copy in `COPY_DECK.md` traces to an "approved
claim" row in `MARKETING_CAPABILITY_LEDGER.md`. Anything not on that list —
testimonials, customer counts, ratings, case studies, nationwide coverage,
automatic submission, trial/pricing language, notifications, team invites —
does not appear, per that document's zero-tolerance fabrication list.

One additional constraint pulled from reading `components/coverage-badge.tsx`
directly (not previously in the ledger): its own header comment calls
miscommunicating jurisdiction coverage tiers **"the single most likely way
this product injures a customer."** The homepage's coverage section
(`COPY_DECK.md` §5) follows that component's exact tier language
(`verified` / `assisted — AI audit off` / `listed — not yet covered`)
rather than inventing softer marketing synonyms for `assisted` or `listed`
that could read as "fully covered."

## 11. Verification plan for "byte-identical when off"

Before Phase 2's commit: run the app locally with `NEXT_PUBLIC_MARKETING_V2`
unset, diff `curl` output (headers + body) for `/`, `/login`, `/applications`
against a pre-change baseline captured on this same branch before Phase 2's
commit. Any diff is a blocking bug, not a judgment call.

## 12. What Phase 2 will NOT do

No changes to auth, billing/entitlements, PDF/AI pipelines, Supabase
migrations, or any `app/(app)/**` route. No new dependencies. No removal or
rename of any existing file. One commit on `feat/marketing-homepage-v2`,
same as this phase.

---

Awaiting **APPROVED: PHASE 1** before Phase 2 (implementation) begins.
