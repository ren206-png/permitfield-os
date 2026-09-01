# Jurisdiction Expansion — Scope & Candidate Research (Draft)

Not part of the LP workstream (Phases 0–3, already shipped). This is a
separate initiative: expanding real jurisdiction *coverage* — the data the
LP pages surface, not the pages themselves. Written for review, nothing
here has been committed or acted on yet.

## 1. Why this isn't a "wiring" problem

Today's coverage is 4 jurisdictions, 2 provinces (`supabase/seed.sql`):

| Jurisdiction | Coverage level | permit_types rows |
|---|---|---|
| Toronto, ON | verified | 1 (Electrical Service Upgrade) |
| Calgary, AB | verified | 1 (Commercial Tenant Improvement) |
| Ottawa, ON | assisted | 0 |
| Hamilton, ON | listed | 0 |

Adding a new jurisdiction isn't one `insert into jurisdictions`. Per the
existing schema and the seed file's own comments, each one that reaches
"Verified" needs the full chain:

1. `jurisdictions` row + `authorities` row(s) — the municipal building
   division, plus any province-wide agency (Ontario's ESA is the existing
   example, handled as a *separate* authority from the municipality).
2. Real research into which permit types a trade contractor actually files
   there, and under what trigger conditions (see the seed file's own
   Electrical Service Upgrade example: triggers a City of Toronto permit
   only conditionally, an ESA notification always).
3. The actual government PDF form, downloaded and inspected with pdf-lib
   (`docs-reference-forms/` holds the 3 real forms in use today).
4. A field map (`permit_form_fields`) — and this is the real cost driver:
   - If the form has genuine AcroForm fields (Toronto's does), fields get
     hand-verified against pdf-lib's field list.
   - If it's a flat/scanned PDF (ESA's ICIA-LV form), it needs
     coordinate-overlay values measured from the actual rendered page.
     Seed data explicitly refuses to fabricate plausible-looking
     coordinates for this case — Calgary's own form is flagged as
     "needs manual page-by-page review" and still has zero field-map rows
     today, six months after being marked Verified for the jurisdiction
     itself. Coverage level and field-map completeness are two different
     things.

So the bottleneck is research and hand-verification labor per jurisdiction,
not code. This document scopes *which* jurisdictions are cheapest to add
next, based on real findings, not a build task to execute unilaterally.

## 2. Deep-dive findings, this session (web research only — no PDFs
   downloaded or inspected yet; see §4 for why that's the deliberate stopping
   point)

**Edmonton, AB** — same province as the existing Calgary jurisdiction.
Commercial Building Permit Application is a real downloadable PDF
(`edmonton.ca/documents/Commercial_Building_Permit_Application.pdf`), and
Edmonton also has grown a modern online self-serve system
(`selfserve.edmonton.ca`) for many permit types — meaning some permits may
no longer be a static form at all, which changes the integration shape for
those specific permit types. Lowest incremental research cost of the
candidates: same province means the same provincial code/authority
landscape Calgary already established.

**Vancouver / Surrey, BC** — both have real downloadable application PDFs
(Vancouver: `dev-build-app-form.pdf`, `cp-building-permit-app.pdf`; Surrey:
`BuildingPermitApplication.pdf`). BC also has a clean province-wide
electrical authority, **Technical Safety BC**, structurally identical to
Ontario's ESA relationship already built into the schema (a separate
`authorities` row, `jurisdiction_id = null`) — TSBC publishes its own
downloadable electrical permit forms (e.g. "Electrical Installation Permit –
Homeowner," Form 1259). This is the closest existing pattern match, and BC
is a large trade-contractor market, so it's a strong second candidate
despite the added authority-setup cost.

**Winnipeg, MB** — multiple per-project-type PDF forms (new dwelling,
addition, basement, deck, commercial) hosted on a `legacy.winnipeg.ca`
domain, suggesting simpler, likely-static forms. Worth a look, but "legacy"
domain plus no visible modern portal is a signal worth confirming before
committing research time.

**Halifax, NS** — has moved building permits onto an online system
("Permitting, Planning Licensing and Compliance," PPLC) rather than a
downloadable static form. That's a materially different integration shape
than the pdf-lib/AcroForm approach this product is built around today —
adding Halifax well might mean building a second intake mechanism, not just
a second form.

**Montreal, QC** — building permits are decentralized to ~19 individual
arrondissements (boroughs), each apparently with its own forms and process
— meaning "Montreal" isn't really one jurisdiction integration, it's
potentially many. Quebec also splits electrical licensing out of the RBQ
(the general construction regulator) into a separate body, the CMEQ
(Corporation des maîtres électriciens du Québec) — an extra authority type
this schema hasn't needed yet. Add French-language form content on top, and
Quebec is clearly the highest-complexity candidate researched this session,
not a natural third or fourth pick.

## 3. AcroForm inspection (done — real findings, not inference)

With your go-ahead, downloaded the candidate PDFs and ran the same pdf-lib
field inspection Phase 0 ran on Toronto/Calgary/ESA
(`PDFDocument.getForm().getFields()`, throwaway scripts, no files leaked
into the repo outside the ones deliberately committed to
`docs-reference-forms/`). Results, across two research passes:

| File | Pages | AcroForm fields | Verdict |
|---|---|---|---|
| Edmonton — Commercial Building Permit Application | 4 | **0** | Flat/scanned. Same category as ESA's ICIA-LV form: would need hand-measured coordinate-overlay values, not a name-based fill. |
| Surrey, BC — Building Permit Application | 2 | **80** | Real AcroForm. **Shipped** — see supabase/seed.sql, coverage_level `assisted`. |
| Technical Safety BC — Electrical Installation Permit (**Homeowner**, Form 1259) | 6 | **163** | Real AcroForm, but this specific form is scoped to homeowners doing their own work, not licensed contractors — see §3a below, this deprioritizes TSBC rather than confirming it. |
| Vancouver, BC — Certified Professional Building Permit Application (`cp-building-permit-app.pdf`) | 2 | **105** | Real AcroForm, fetched via a real browser session (direct `curl` hit vancouver.ca's bot-detection, a browser fetch didn't). Scoped to the CP (Certified Professional) fast-track stream — requires the applicant already have a CP retained, narrower audience than the general path. |
| Vancouver, BC — Development and/or Building Permit Application (`dev-build-app-form.pdf`) | 3 | **158** | Real AcroForm, same browser-fetch resolution. General-purpose form (new build, addition, interior/exterior alteration, demolition all on one form via checkboxes) — closer structural analog to Surrey's form than the CP one. Largest verified AcroForm surface area of any candidate so far. |
| Winnipeg, MB — Alterations (Single/Two Family Dwelling) Building Permit Application | 4 | **0** | Flat/scanned, same bottleneck as Edmonton. `curl` worked fine (no bot-detection), the PDF itself is just non-fillable. |
| Winnipeg, MB — Development Permit Application (Residential/Commercial) | 3 | **0** | Same — flat/scanned. |

### 3a. Technical Safety BC — deprioritized, not confirmed

The 163-field PDF inspected is specifically titled **"Electrical
Installation Permit – Homeowner"**, and TSBC maintains a genuinely separate
**Homeowner Electrical Permits** page/category
(`technicalsafetybc.ca/apply-for/permits/homeowner-permits/...`) distinct
from the contractor path. For licensed contractors — this product's actual
audience — TSBC's real process is: apply through an **online services
account** (portal) or an **online form** (not confirmed to be a downloadable
static PDF), with a **Field Safety Representative (FSR)** — a TSBC-certified
individual — required on every application to validate work and request
inspections. No contractor-specific downloadable static PDF was found
distinct from the Homeowner form. This looks structurally closer to
**Halifax's problem** (portal-mediated intake, not the pdf-lib/AcroForm
pattern this product is built around) than to Toronto/Surrey's pattern.
Revisit only if a genuine contractor-facing static form turns up, or once a
portal-intake mechanism exists as a second integration shape.

### 3b. Winnipeg — same bottleneck as Edmonton, plus a live portal in parallel

Both Winnipeg forms inspected are flat (0 fields) — the coordinate-overlay
problem this product doesn't yet have a verified workflow for (same
unresolved state as Calgary's own form, months later). Separately,
winnipeg.ca now runs a parallel **"Permits Online"** portal
(`permitsonline.winnipeg.ca`) alongside the `legacy.winnipeg.ca` PDF forms;
search results describe it as accepting "integrated online forms rather
than external PDFs" for most standard submissions, though the legacy PDFs
are still live and linked, not confirmed dead. Net effect either way:
Winnipeg doesn't look cheaper than Edmonton anymore — flat-PDF bottleneck at
minimum, possibly also a portal-shape problem on top.

This **updates the ranking again**: Vancouver, previously unassessed due to
a fetch-tooling limitation (not a real property of the jurisdiction), turns
out to have two real, large AcroForms — the best-verified BC candidate
after Surrey. TSBC and Winnipeg both move down: TSBC because the only form
inspected doesn't match this product's audience, Winnipeg because its real
forms are flat like Edmonton's.

## 4. Revised ranked recommendation

1. ~~Surrey, BC~~ — **shipped** (see §5b). Real 80-field AcroForm, single
   municipal authority, closest match to the one pattern already fully
   proven (Toronto).
2. **Vancouver, BC** — real 158-field AcroForm (`dev-build-app-form.pdf`,
   general-purpose, closer analog to Surrey's form than the CP-track one).
   BC's largest trade-contractor market; Surrey alone doesn't cover it.
   Needs the same research pass Surrey got: real permit type/trigger
   conditions, hand-verified field subset, `coverage_level: assisted`.
3. **Edmonton, AB** — flat PDF, same overlay-coordinate bottleneck Calgary's
   form is already stuck in. Revisit once the coordinate-overlay
   verification workflow actually exists, not before.
4. **Winnipeg, MB** — newly deprioritized to Edmonton's tier: both
   downloaded forms are flat, and a parallel online portal may already be
   superseding the PDF path for standard submissions.
5. **Technical Safety BC** — newly deprioritized. The only form inspected is
   homeowner-scoped, not contractor-scoped; the real contractor path looks
   portal + FSR-mediated, a different integration shape than this product is
   built around. Revisit only with a confirmed contractor-facing static form.
6. **Defer: Halifax, NS and Montreal/QC** — same reasoning as before
   (portal-based intake / per-arrondissement fragmentation + a second
   licensing body). Revisit once 2-3 provinces are proven, not before.

## 5. Gap fixed this session

`app/(marketing)/sections/coverage.tsx` (the homepage's "What's covered
today" section) was a hardcoded `JURISDICTIONS` array — it happened to
match `supabase/seed.sql`'s 4 rows but had no real link to the database.
Rewired it to call the same `lib/jurisdictions/public-directory.ts` module
and `public_jurisdictions`/`public_permit_types` views the `/coverage` and
`/permits/...` pages already use, and to link to a jurisdiction's detail
page only when `PERMITFIELD_FF_JURISDICTION_PAGES` is on and that
jurisdiction actually `hasDetailPage` — same thin-content discipline as
`app/coverage/page.tsx`. Verified via all 3 build configs (flag off; flag
on + anon-rls; flag on + service-role) plus eslint, all clean.

While fixing it, found and fixed a second instance of the same drift
pattern: `app/(marketing)/sections/hero.tsx`'s subhead hardcoded the
literal jurisdiction count ("4 Canadian jurisdictions"). Dropped the number
entirely rather than wiring a second component to the database just to
render one word — the sentence now reads "the Canadian jurisdictions we
cover today" with the same `#coverage` link. Also updated that file's
now-stale comment, which referenced coverage.tsx's since-removed
`JURISDICTIONS` array by name.

Checked for further instances of the same pattern (grepped for
Toronto/Calgary/Ottawa/Hamilton across `app/`, `lib/`, `components/`):
`app/(marketing)/sections/capabilities.tsx` names "the Toronto Electrical
Service Upgrade form" specifically — left as-is, since that's a true,
narrow claim about one specific real feature (matches
`MARKETING_CAPABILITY_LEDGER.md`'s own required wording for that claim),
not a jurisdiction-count list that goes stale as coverage grows. No other
hardcoded jurisdiction lists found in code.

`COPY_DECK.md` and `MARKETING_CAPABILITY_LEDGER.md` (the design docs
`marketing-homepage.tsx`'s own header says must stay in sync with any
homepage copy change) still reference Toronto/Calgary/Ottawa/Hamilton in
prose — not updated at the time coverage.tsx/hero.tsx were fixed, because
the rendered content hadn't changed yet. It has now (§5b) — these two docs
still need a real edit reflecting Surrey, not done as part of this pass
either; flagging again so it isn't dropped a second time.

## 5b. Surrey, BC — shipped

Per the ranked recommendation above, Surrey went through the full research
pass and is now real seed data: `supabase/seed.sql` (jurisdiction, `City of
Surrey - Building Division` authority citing Surrey Building Bylaw 2012 No.
17850, a `Commercial Tenant Improvement` permit_type sourced from the City's
real "Tenant and Landlord Improvement Building Permit" page, one
unconditional filing, 5 hand-verified `permit_form_fields` rows),
`README.md`'s citation table and jurisdiction-count/"Limits" paragraph, and
`docs-reference-forms/surrey-building-permit-application.pdf` (the real
inspected PDF, alongside Toronto/Calgary/ESA's). `coverage_level: assisted`
— no direct BC Building Code review yet, same bar Ottawa/Hamilton are held
to. Committed and pushed.

## 6. Decision needed

With TSBC and Winnipeg now deprioritized (§3a, §3b) and Vancouver newly
assessed as two real AcroForms, **Vancouver, BC** is the clear next
candidate — same reasoning that made Surrey the pick: real AcroForm,
single form, BC's largest trade-contractor market, and Surrey already
established the province-wide pattern (no new authority-type needed,
unlike Technical Safety BC). If you want to proceed, the next steps mirror
Surrey's: (a) research Vancouver's real permit types/trigger conditions
for the `dev-build-app-form.pdf` general path — likely scoping to
"interior alteration"/tenant-improvement-equivalent the same way Surrey's
was scoped to tenant (not landlord) improvement, (b) hand-verify a
restrained field subset against the 158 real field names already captured,
(c) `coverage_level: assisted`, same bar as Surrey/Ottawa/Hamilton. §5's
still-open item (COPY_DECK.md / MARKETING_CAPABILITY_LEDGER.md needing a
real edit for Surrey) is independent of this and still outstanding either
way.
