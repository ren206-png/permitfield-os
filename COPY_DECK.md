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

**Subhead:**
> PermitField OS keeps your permit applications, documents, and filing
> status in one place — with AI-assisted extraction to cut down manual data
> entry. Built for contractors working in Toronto and Calgary today.

Grounding: §1 (intake/tracking, SHIPPED), §2 (AI extraction, SHIPPED —
qualified), jurisdiction table (Toronto/Calgary verified). "Cut down manual
data entry" is used instead of "auto-fills your application" per §2's
explicit qualification against overclaiming compliance/completeness.

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
  Upgrade form today, with more forms being added over time. (§3 — worded
  as current + narrow, per ledger's qualified-claim language, not "fills
  any permit form")
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

> **Toronto, ON** — Verified coverage
> **Calgary, AB** — Verified coverage
> **Ottawa, ON** — Assisted (AI audit off)
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
Toronto and Calgary.

No Open Graph image, no structured data (`schema.org`/JSON-LD) in this
phase — both explicitly belong to Phase 3 per the master prompt's own phase
scope, and neither exists to reference yet (no real screenshot has been
captured — see `MARKETING_PHASE_0_FINDINGS.md` §7 for the plan to capture
one from seed data before it's needed).

---

Awaiting **APPROVED: PHASE 1** before Phase 2 (implementation, behind
`NEXT_PUBLIC_MARKETING_V2`, default off) begins.
