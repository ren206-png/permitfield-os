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

With your go-ahead, downloaded the 5 named candidate PDFs and ran the same
pdf-lib field inspection Phase 0 ran on Toronto/Calgary/ESA
(`PDFDocument.getForm().getFields()`, one throwaway script, no files
committed to the repo). Results:

| File | Pages | AcroForm fields | Verdict |
|---|---|---|---|
| Edmonton — Commercial Building Permit Application | 4 | **0** | Flat/scanned. Same category as ESA's ICIA-LV form: would need hand-measured coordinate-overlay values, not a name-based fill. |
| Surrey, BC — Building Permit Application | 2 | **80** | Real AcroForm, comparable in kind to Toronto's — genuinely fillable by field name. |
| Technical Safety BC — Electrical Installation Permit (Homeowner, Form 1259) | 6 | **163** | Real AcroForm. Larger surface area than Toronto's (163 fields across 6 pages vs. Toronto's 3 verified so far), but name-based, not overlay. |
| Vancouver — both forms (`dev-build-app-form.pdf`, `cp-building-permit-app.pdf`) | — | — | **Blocked.** vancouver.ca returned HTTP 403 (bot-detection page, not the PDF) to a direct fetch. Not yet assessed — would need a browser-based fetch, not curl. |

This **flips the earlier ranking**: Edmonton looked cheapest from search
snippets alone, but its actual form is a flat PDF — the same "needs manual
coordinate measurement, don't fabricate it" situation Calgary's own form is
still stuck in, unresolved 6+ months later. Surrey and Technical Safety BC
both turned out to be genuine AcroForms, which is the proven-cheaper path
(name-based fill, same mechanism as Toronto).

## 4. Revised ranked recommendation

1. **Surrey, BC** — real 80-field AcroForm, single municipal authority,
   closest match to the one pattern already fully proven (Toronto).
2. **Technical Safety BC** (province-wide electrical authority, pairs with
   any BC municipality — same relationship as Ontario's ESA) — real
   163-field AcroForm. More fields to hand-verify than Toronto's 3, so more
   labor, but no overlay-measurement problem.
3. **Edmonton, AB** — deprioritized from where it started. Flat PDF, same
   overlay-coordinate bottleneck Calgary's form is already stuck in with
   zero verified fields months later. Revisit once the coordinate-overlay
   verification workflow actually exists, not before.
4. **Vancouver, BC** — unassessed; the site's bot-detection blocked a
   direct fetch. Worth a second attempt (browser-based) if BC is the
   direction you pick, since Surrey alone doesn't cover BC's largest market.
5. **Winnipeg, MB** — not yet downloaded/inspected this round.
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
prose — not updated, because the actual rendered content didn't change
(still the same 4, same tiers), only the mechanism producing it. These
docs would need a real edit once jurisdiction coverage actually changes,
not from this pass.

## 6. Decision needed

Pick a direction for §4 — Surrey, BC and/or Technical Safety BC look like
the actual best next candidates now that field data is real rather than
inferred. If you want to proceed, the next steps per candidate are: (a)
research real permit types/trigger conditions for that jurisdiction, (b)
hand-verify each AcroForm field name against what the form is actually
asking for (same as Toronto's 3), (c) decide initial `coverage_level`
("assisted" until code requirements are directly reviewed, matching
Ottawa/Hamilton's existing pattern, not "verified" on day one).
