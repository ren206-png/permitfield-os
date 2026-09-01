# COPY_DECK.md — Marketing Homepage v2

Phase 1 deliverable. No code in this phase. Every claim below is tagged with
its `MARKETING_CAPABILITY_LEDGER.md` row (`§N`). Nothing here appears
without a citation. Nothing on that document's zero-tolerance fabrication
list appears anywhere below — no testimonials, logos, customer counts,
ratings, case studies, pricing/trial language, nationwide coverage claims,
notification promises, or team-invite copy.

## 1. Nav

Wordmark: **PermitField OS** (`lib/brand.ts` `PRODUCT_NAME`, text
logotype — see `IMPLEMENTATION_PLAN.md` §6 for why no icon/mark asset is
invented).

Links: *How it works* · *What's covered* · *Sign in*
(`/login`, existing route, unchanged)

Primary button: **Create your account** → `/login` (existing sign-up form)

No pricing link (§15: nothing to price). No "Coverage" as a standalone nav
concept distinct from the on-page coverage section — Phase 0 flagged this
for confirmation and it's resolved here by folding it into an in-page
anchor rather than a separate route, so there's no unfinished page to 404.

## 2. Hero

**Headline:**
> Permit applications, organized from intake to filing.

**Subhead (updated — see note below):**
> PermitField OS keeps your permit applications, documents, and filing
> status in one place — with AI-assisted extraction to cut down manual data
> entry. Built for contractors in the Canadian jurisdictions we [cover
> today](#coverage).

Grounding: §1 (intake/tracking, SHIPPED), §2 (AI extraction, SHIPPED —
qualified), jurisdiction table (now 6 jurisdictions across ON/AB/BC, not
just Toronto/Calgary verified). "Cut down manual data entry" is used
instead of "auto-fills your application" per §2's explicit qualification
against overclaiming compliance/completeness.

**Note (jurisdiction-expansion follow-up):** originally this subhead named
"Toronto and Calgary" directly in prose. Rewritten when Ottawa/Hamilton
were added, then again now that Surrey and Vancouver (BC) are seeded too —
naming cities in the subhead is exactly the same drift risk the
`coverage.tsx` section's old hardcoded `JURISDICTIONS` array was: a literal
city list here would need a manual edit on every future jurisdiction add,
and would silently go stale if missed. The wording above is what actually
shipped in `app/(marketing)/sections/hero.tsx` — no city names, an anchor
link to `#coverage` where tiers (and now Surrey/Vancouver) are disclosed —
this document is being corrected to match reality rather than left stale.
The jurisdiction *count* is deliberately not stated either, same reasoning,
one word smaller — see that file's own header comment.

**Primary CTA:** Create your account
**Secondary CTA:** See how it works (in-page anchor to §3 below)

No "free," "trial," or price mentioned (§15).

## 3. How it works (3 steps — every verb maps to a SHIPPED capability)

1. **Start an application.** Add project and jurisdiction details to create
   a new permit application. — §1
2. **Upload your documents.** PermitField extracts key applicant,
   contractor, and scope details automatically, so you're not retyping what's
   already in your paperwork. — §2
3. **Track it through to filing.** Watch your application move from draft
   to documents-ready, and mark it submitted once you've filed with the
   authority. — §5 (worded to match what the product actually does: the
   contractor files, the product tracks status — never "we submit it for
   you")

## 4. What PermitField OS does today (capability highlights)

Four cards, each one sentence, each with a ledger citation in the
implementation as a code comment (not shown to visitors):

- **Centralized intake & tracking** — every application's documents,
  status, and history in one record. (§1, §18)
- **AI-assisted document extraction** — key fields pulled from your
  uploads for review, not blind auto-fill. (§2)
- **Form auto-fill where supported** — for the Toronto Electrical Service
  Upgrade, Surrey Commercial Tenant Improvement, and Vancouver Commercial
  Tenant Improvement forms today, with more forms being added over time.
  (§3 — worded as current + narrow, per ledger's qualified-claim language,
  not "fills any permit form"; updated by the jurisdiction-expansion
  follow-up, which added the Surrey and Vancouver field maps)
- **Organization-level data isolation** — your applications are scoped to
  your organization, enforced at the database layer. (§10)

Explicitly excluded from this section (would require ledger rows that don't
exist as SHIPPED/approved-claim): notifications, deadline alerts, team
invites, analytics/reporting, e-signature, third-party API/integrations.

## 5. What's covered today (coverage section)

Framed honestly and narrowly, matching `components/coverage-badge.tsx`'s
own tier language exactly — that component's header comment calls
miscommunicating coverage tiers "the single most likely way this product
injures a customer," so this section does not soften or rename the tiers:

**Note (jurisdiction-expansion follow-up):** this section's rows below were
originally written as static Phase 1 design copy — 4 hardcoded rows. The
actual Phase 2 implementation (`app/(marketing)/sections/coverage.tsx`) does
**not** hardcode this list; it queries `lib/jurisdictions/public-directory.ts`
live against the same `public_jurisdictions`/`public_permit_types` views
`/coverage` and the sitemap use, specifically so this list can never drift
from what the database actually contains (see
`JURISDICTION_EXPANSION_SCOPE.md` §5 for why the old hardcoded array was a
bug, not a feature). The rows below are therefore an illustrative snapshot
of current data, not literal component copy to re-type on every add:

> **Toronto, ON** — Verified coverage
> **Calgary, AB** — Verified coverage
> **Ottawa, ON** — Assisted (AI audit off)
> **Surrey, BC** — Assisted (AI audit off)
> **Vancouver, BC** — Assisted (AI audit off)
> **Hamilton, ON** — Listed only (not yet covered)

Supporting line:
> PermitField OS is expanding jurisdiction by jurisdiction. "Verified"
> means we've reviewed the applicable code and requirements directly;
> "Assisted" and "Listed" jurisdictions are earlier in that process — see
> in-product coverage badges for what's enabled at each stage.

No claim of "Canada-wide," "nationwide," "all provinces," or any specific
future jurisdiction/date not already true today. This directly implements
Phase 0's jurisdiction-coverage guardrail and the ledger's forbidden-claims
list.

## 6. Footer CTA

**Headline:** Ready to organize your next permit application?
**Button:** Create your account → `/login`
**Small print (optional, only if legal/brand wants it):**
`LEGAL_DISCLAIMER` from `lib/brand.ts`, verbatim, unmodified:
> "PermitField provides AI-assisted review. Not legal or code advice.
> Verify with the authority having jurisdiction before submission."

Reusing this existing constant rather than writing new legal copy keeps
this disclaimer consistent with wherever else the product already shows it,
and avoids inventing new legal language outside this phase's scope.

## 7. Footer links

`Sign in` (`/login`) · `PRODUCT_NAME` copyright line, current year, no
social links (none exist to link to), no company-address boilerplate
(out of scope — not a legal filing requirement addressed by this phase).

## 8. Page metadata (minimal, Phase 2 scope; full technical SEO in Phase 3)

`app/layout.tsx` already sets a site-wide title of `PRODUCT_NAME` and a
generic description. Phase 2 may add a homepage-specific
`export const metadata` override in the new route only if `app/page.tsx`'s
structure allows a clean per-branch override without affecting the
authenticated-app render path — if not, this is deferred to Phase 3 as well
rather than forced in. Draft text if used:

**Title:** PermitField OS — Permit application tracking for contractors
**Description:** Organize permit applications, documents, and filing status
in one place, with AI-assisted document extraction. Currently covering
select Canadian jurisdictions — see /#coverage for the current list.

(Note, jurisdiction-expansion follow-up: originally drafted as "Currently
covering Toronto and Calgary" — corrected here for the same reason as §2's
hero subhead: a hardcoded city list in draft metadata copy is a second
place this same drift could reappear later. Now 6 jurisdictions across
ON/AB/BC are seeded; naming any fixed subset risks going stale again on
the next add.)

No Open Graph image, no structured data (`schema.org`/JSON-LD) in this
phase — both explicitly belong to Phase 3 per the master prompt's own phase
scope, and neither exists to reference yet (no real screenshot has been
captured — see `MARKETING_PHASE_0_FINDINGS.md` §7 for the plan to capture
one from seed data before it's needed).

---

Awaiting **APPROVED: PHASE 1** before Phase 2 (implementation, behind
`NEXT_PUBLIC_MARKETING_V2`, default off) begins.
