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
| Edmonton, AB — Commercial Building Permit Application for Interior Alterations (Short-Form) | 2 | **0** | Flat/scanned. This is the actual tenant-improvement-scoped form (`edmonton.ca/business_economy/form-listing`'s own description: "interior alterations/tenant improvements to existing floor and mezzanine areas") — checked specifically because it's a different, shorter PDF than the main Commercial Building Permit Application already inspected, on the theory a shorter form might be a real AcroForm. It isn't. |
| Edmonton, AB — Electrical Permit Application Form (Contractors) | 2 | **0** | Flat/scanned. Checked as Edmonton's analog to Toronto/ESA's second-authority pattern (trade permit, separate from the building permit). Also non-fillable. |

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

**This speculation is now resolved — see §3d.** The portal turns out to be
login-gated, not a PDF-free alternative; the legacy PDFs are still very much
alive (one of them redirects into the new portal, the other, `legacy.
winnipeg.ca`, still serves the actual form documents directly).

### 3d. Winnipeg — portal confirmed login-gated, third form confirmed flat

Follow-up pass (browser tools, since `WebFetch` 403'd on `winnipeg.ca`
directly — same bot-detection pattern already worked around for
`vancouver.ca`). Two things resolved:

1. **A third Winnipeg form, the real CTI analog, also comes back flat.**
   `winnipeg.ca`'s "Permits Online" landing page (`/building-development/
   permits-applications/permits-online`) links out to
   `legacy.winnipeg.ca/ppd/Documents/Permits/CommercialAlterationDesignSummary/
   Commercial-Alteration-Design-Summary.pdf` — the **Commercial Alteration
   Design Summary**, Winnipeg's actual form for "interior and/or exterior
   alterations and change of use," the closest structural match to the
   Toronto/Surrey/Vancouver Commercial Tenant Improvement permit_type used
   elsewhere in this schema (11 pages, 476KB, downloaded via direct `curl`
   with a browser user-agent — no bot-detection on `legacy.winnipeg.ca`
   itself). pdf-lib inspection: **0 AcroForm fields**. That's three Winnipeg
   forms now, across residential and commercial, all flat — the same
   "jurisdiction-wide PDF-authoring choice" pattern §3c documents for
   Edmonton, not a single unlucky form.

2. **The "Permits Online" portal is a real application, but it's
   login-gated, not a PDF-free path.** The old `ppdportal.winnipeg.ca`
   (AMANDA/eNtraprise-branded) URL now hard-redirects with a "System
   Upgrade" notice to `permitsonline.winnipeg.ca`, which is a genuine
   account-based case-management system — "apply for development
   applications, permits and other services," "save & return to partially
   completed applications for up to 30 days," invoices, payments, contractor
   licensing. But the landing page requires **Login / Create account**
   before any application screen is reachable; no application form fields
   are visible unauthenticated, and creating an account wasn't done (out of
   scope for research, and a permission-gated action regardless). The
   portal's own help text also says supporting documentation still has to be
   attached to whatever's entered online — i.e., the flat design-summary PDF
   above doesn't go away even for portal applicants, it just becomes an
   attachment inside an authenticated flow instead of an email attachment.

Net effect: Winnipeg isn't a shortcut around Edmonton's blocker. It's
confirmed flat on the PDF side (3-for-3) *and* its live-portal alternative
is a different, unproven integration shape (login-gated web-form/session
automation, not a name-based AcroForm fill) — closer to Halifax's
portal-mediated problem (§3a) than to a simpler version of Surrey/Vancouver.
Building against it would mean session/account automation against an
authenticated system whose internal field structure is currently unknown,
which is arguably a bigger unknown than the coordinate-overlay path, not a
smaller one. Per your direction, parked alongside Edmonton — not pursued
further this session.

This **updates the ranking again**: Vancouver, previously unassessed due to
a fetch-tooling limitation (not a real property of the jurisdiction), turns
out to have two real, large AcroForms — the best-verified BC candidate
after Surrey. TSBC and Winnipeg both move down: TSBC because the only form
inspected doesn't match this product's audience, Winnipeg because its real
forms are flat like Edmonton's.

### 3c. Edmonton — confirmed flat across three separate forms, not a single-form fluke

Starting the Edmonton pass, checked two more Edmonton PDFs beyond the
original Commercial Building Permit Application (already known flat): the
actual tenant-improvement-scoped **Short-Form** (edmonton.ca's own
description matches this product's target permit type more closely than
the main commercial form does) and the **Electrical Permit Application –
Contractors** form (Edmonton's analog to Toronto/ESA's second-authority
pattern). Both downloaded cleanly via direct `curl` (no bot-detection, same
as the original Edmonton form) and both inspected at **0 AcroForm fields**.
Three different Edmonton forms, across two different departments (building
vs. electrical trade), all flat. This isn't one unlucky form — it looks
like a jurisdiction-wide PDF-authoring choice, which raises confidence that
a fourth or fifth Edmonton form would also come back flat rather than being
worth more research spend to find a fillable one.

Practical effect: there is currently no path to add Edmonton at Surrey/
Vancouver's cost (name-based AcroForm fill). The only path is the
coordinate-overlay column set (`permit_form_fields.overlay_page/x/y`),
which exists in the schema and is exercised in `eval/` against a synthetic
test-only fixture, but has **never been run against a real government
form** — Phase 0 explicitly stopped short of that for Calgary and ESA
rather than fabricate plausible-looking coordinates, and that's still true
today. Measuring real overlay coordinates means opening the actual
rendered PDF (e.g., in a viewer or via a rendering library) and recording
pixel positions by hand for each field — a materially different, and
currently unproven, kind of work versus reading AcroForm field names
programmatically. Not started; flagged here as a decision point rather
than begun unilaterally.

## 4. Revised ranked recommendation

1. ~~Surrey, BC~~ — **shipped** (see §5b). Real 80-field AcroForm, single
   municipal authority, closest match to the one pattern already fully
   proven (Toronto).
2. ~~Vancouver, BC~~ — **shipped** (see §5c). Real 158-field AcroForm
   (`dev-build-app-form.pdf`, general-purpose path), `coverage_level:
   assisted`.
3. **Edmonton, AB** — flat across three separate forms now (§3c), same
   overlay-coordinate bottleneck Calgary's form is already stuck in, and
   with more confidence now that a fourth form would come back the same
   way. Blocked on a coordinate-overlay verification workflow that has
   never been run against a real form. Revisit once that workflow exists,
   or deprioritize further in favor of Winnipeg's live portal (§3b) if that
   turns out to be a static-form-free path worth a second integration
   shape.
4. **Winnipeg, MB** — confirmed same tier as Edmonton (§3d): three
   downloaded forms are flat (not just the original two), and the parallel
   "Permits Online" portal turns out to be login-gated case-management
   software, not a PDF-free static-form alternative — a different and
   likely bigger integration lift (session/account automation against an
   unknown authenticated form structure), not a cheaper one. Parked, same as
   Edmonton, per your direction.
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

With Surrey and Vancouver both shipped (§5b, §5c), the next candidate in
rank order is Edmonton — but §3c's finding changes what "starting Edmonton"
actually means. Every real Edmonton form found so far (3 of 3, across
building and electrical) is flat, so there is no Surrey/Vancouver-shaped
path available (no AcroForm to hand-verify field names against). Two real
options, not a third silent one:

(a) **Build and prove the coordinate-overlay workflow for the first time**,
    against one of the three real Edmonton PDFs already downloaded (most
    likely the Short-Form, since it's the actual tenant-improvement-scoped
    form). This means opening the rendered PDF, measuring real pixel
    positions for a restrained field subset by hand, and validating the
    existing `overlay_page/x/y` fill path against real coordinates for the
    first time (today it's only exercised against a synthetic fixture).
    Bigger, unprecedented lift versus Surrey/Vancouver's name-based fill —
    but Edmonton is the same province as the already-`verified` Calgary
    jurisdiction, so the research/citation side is cheap even if the field-
    map side isn't.

(b) **Skip Edmonton for now** and either (i) revisit Winnipeg's
    `permitsonline.winnipeg.ca` portal (§3b) as a live-form path instead of
    its own flat PDFs, or (ii) look at a not-yet-researched jurisdiction.
    Neither has been scoped in detail yet.

Not proceeding with either until you pick a direction. §5's still-open item
(COPY_DECK.md / MARKETING_CAPABILITY_LEDGER.md needing a real edit for
Surrey, and now Vancouver too) is independent of this and still
outstanding either way.

**Update:** option (b)(i) has since been checked and closed out — see §3d.
Winnipeg's portal is login-gated case-management software, not a PDF-free
static-form path; per your direction ("skip winnipeg for now"), it's parked
at the same tier as Edmonton, not pursued further. Option (b)(ii) is now
resolved too — see §7: Richmond, BC is a confirmed, real candidate.

## 5c. Vancouver, BC — shipped

Per §4, Vancouver went through the full research pass and is now real seed
data: `supabase/seed.sql` (jurisdiction, `City of Vancouver - Development
and Building Services Centre` authority citing Vancouver Building By-law No.
14343 — the only Canadian municipality with its own building code — a
`Commercial Tenant Improvement` permit_type sourced from the City's real
Building Permit page and explicitly scoped away from both the separate
Tenant Improvement Program (TIPs) fast-track and the Certified Professional
track, one unconditional filing, 6 hand-verified `permit_form_fields` rows
against the 158-field general-path form), `README.md`'s citation table and
jurisdiction-count/"Limits" paragraph (now 6 seed jurisdictions, 3
`assisted`), and `docs-reference-forms/vancouver-dev-build-app-form.pdf`
(the real inspected PDF). `coverage_level: assisted` — no direct Vancouver
Building By-law review yet, same bar Surrey/Ottawa/Hamilton are held to.
The applicant-contact-block field mapping is flagged in `seed.sql` itself
as a lower-confidence inference (7 repeated, suffix-only-differentiated
contact blocks, no OCR/layout tool available to resolve section labels).
Committed and pushed.

## 7. New-jurisdiction pass — Toronto freshness watch, Ontario "one-form" hypothesis disproved, Richmond BC confirmed

Three findings from resuming §6's "look at a not-yet-researched jurisdiction"
option, in order of how they surfaced.

**7a. Toronto's shipped form — a freshness watch item, not a live problem.**
While researching whether Ontario has one province-wide fillable form (see
§7b), found that the Ontario government updated the standard "Application
for a Permit to Construct or Demolish" form, effective **February 16,
2026**, per Ontario Building Officials Association CodeNews Issue 377 — the
current version hosted at `ontario.ca` (dated 2026-01-27) is materially
larger than what's shipped today (133 fields / 4 pages, including new
Designer and Sewage System Installer sections, vs. our 71 fields / 2 pages).
Checked whether this makes our shipped Toronto data stale relative to its
real source: it does not — Toronto's own live Building Forms Index page
still links, byte-for-byte identical (SHA-256 verified), to the exact
Oct-2025 PDF already in `docs-reference-forms/toronto-permit-application.pdf`.
So the City of Toronto itself hasn't adopted the province's mandated update
yet; our data accurately mirrors the actual current authoritative source, not
a stale copy of it. Also confirmed the 3 fields already mapped in `seed.sql`
("Applicant Last name", "Applicant First name", "Project value estimated (in
dollars)") are unchanged in the new provincial version, so nothing breaks if
Toronto adopts it later. No action taken — flagged here as something worth
re-checking periodically (Toronto's forms index page), not a regression.

**7b. Ontario "one province-wide form" hypothesis — tested, disproved.**
Hypothesis: since "Application for a Permit to Construct or Demolish" is a
single province-approved form, other Ontario municipalities might host the
*same* AcroForm, letting Toronto's already-verified field map (§ above)
transfer to a new ON jurisdiction near-free. Downloaded Mississauga's real
copy (linked from its own current publication page, dated 2026/02) and
pdf-lib-inspected it: **87 fields, but a completely different AcroForm** —
generic auto-numbered field names (`Text1`, `Text6`, `Check Box14`, etc.),
none matching Toronto's field names. Each municipality re-authors its own
AcroForm around the legislated content; the underlying document/legal
content is standardized, but the actual fillable PDF and field names are
not. Correcting course before this became a wrong assumption baked into
seed data: a new Ontario jurisdiction still needs its own from-scratch
AcroForm verification, same cost as Surrey/Vancouver — and Mississauga's
generic field names would need visual (not name-based) matching against the
rendered page to verify with confidence, a harder version of the ambiguity
already flagged for Vancouver's repeated contact blocks. Not pursued
further this pass; Mississauga remains a real, technically-viable candidate
for a future pass willing to take on that harder verification method.

**7c. Burnaby, BC — checked, ruled out.** Burnaby is phasing out its
downloadable commercial-building PDF entirely: its own site states paper
applications for new commercial buildings stop being accepted January 2,
2026 (already passed) in favour of "My Permits Portal," and — more directly
relevant — **commercial tenant improvement applications must be applied for
in-person at City Hall**, no downloadable-PDF path at all for our target
permit type. Same practical blocker shape as Winnipeg/Edmonton (no
AcroForm-fill path available today), for a different reason (deliberate
portal migration + in-person-only TI process, not a flat/scanned PDF).
Not pursued further.

**7d. Richmond, BC — confirmed candidate, real AcroForm.** Richmond's own
live **"Commercial TI Building Permit Requirements"** page
(`richmond.ca/business-development/building-approvals/permits.htm`) directly
lists and links **PL-43, "Building Permit Application Form - Addition and
Alterations"** as the current application form for commercial tenant
improvements. Downloaded and pdf-lib-inspected: a real **117-field AcroForm,
4 pages**, with descriptive field names matching the applicant/owner/
contractor/value/description pattern already used for Toronto/Surrey/
Vancouver — `ProjectStreetAddr`, `WorkDesc`, `ApplName`/`ApplTel`/
`ApplEmail`, `POName`/`POTel`/`POEmail` (property owner), `ConName`/
`ConBizLic` (contractor), `IntValue`/`ExtValue` (interior/exterior alteration
value). `isRequired()` reports false for every field, consistent with every
other real form checked to date — checked, not assumed, same as Surrey/
Vancouver's own note on this.

Checked the obvious risk before treating this as settled: Richmond also runs
a MyPermit online portal (`richmond.ca/business-development/e-plan/
mypermit.htm`), so confirmed PL-43 is genuinely today's live path and not a
legacy artifact next to a mandatory portal (the same trap Burnaby fell into,
§7c). MyPermit's own page explicitly lists **"Building Permit,
Addition/Alteration, Tenant Improvement, all buildings"** under **"Coming
Soon (2026/2027)"** — not yet available online as of this research pass.
PL-43 is confirmed as the current, primary submission path for exactly our
target permit type.

This is the best-evidenced new candidate found since Vancouver: comparable
scale to Surrey (80 fields), better-labeled than Mississauga's generic
fields, and no portal-migration risk in the near term (the relevant
application type is explicitly not scheduled to move online before 2027).
Not yet written to `supabase/seed.sql` — real research pass done, field map
not yet drafted, per the same propose-then-confirm pattern used for
Surrey/Vancouver.

**Revised ranking (supersedes §4's Edmonton/Winnipeg/TSBC ordering for the
next pick):**

1. **Richmond, BC** — real 117-field AcroForm, confirmed PDF-primary today,
   closest-pattern match to Surrey/Vancouver of any candidate found since.
   Next in line if you want to proceed with a full research-and-field-map
   pass, same shape as Surrey/Vancouver.
2. Mississauga, ON (§7b) — real 87-field AcroForm, but generic field names
   requiring visual (not name-based) verification; technically viable, more
   labor per field than Richmond.
3. Edmonton, AB / Winnipeg, MB — both confirmed flat across all real forms
   found (3-for-3 each); blocked on the unproven coordinate-overlay
   workflow. No change from §4/§3d.
4. Technical Safety BC — still deprioritized (§3a), no confirmed
   contractor-facing static form.
5. Burnaby, BC (§7c) — ruled out, no downloadable-PDF path for the target
   permit type.
6. Defer: Halifax, NS and Montreal/QC — unchanged from §4.

## 8. Coquitlam, BC — confirmed and written, cleanest field names yet

Richmond (§7d) has since been written to `supabase/seed.sql` and shipped.
Looking for the next candidate, checked two more BC municipalities before
committing to Mississauga's harder generic-field-name verification path
(§7b): Kelowna (site blocks direct `WebFetch`/`curl`, same bot-detection
shape as vancouver.ca/winnipeg.ca — not pursued further this pass) and
**Coquitlam, BC**, which turned out to be the strongest candidate found
since Vancouver.

**Authority citation:** verified against the City's own consolidated bylaw
text (`publicdocs.coquitlam.ca`, not a search-snippet guess) — title page
reads **"CITY OF COQUITLAM BUILDING BYLAW NO. 3598, 2003"** (consolidated
with amendments through Bylaw 5189, 2022).

**Form:** Coquitlam's general **"Permit Application Form"**, linked directly
from the City's live **Tenant Improvements** page
(`coquitlam.ca/517/Tenant-Improvements`). Downloaded and pdf-lib-inspected:
a real **95-field AcroForm, 3 pages**, `field.isRequired()` reports `false`
throughout (checked, not assumed, same as every other real form here).

Field names are the cleanest set found since Toronto — fully descriptive,
single-instance, no ambiguity to flag: `Applicant Name`, `Applicant Email
Address`, `Site Address`, `Summary of Project Proposed`, `Construction
Value`. Unlike Vancouver's repeated seven-times contact blocks or Richmond's
three-way `IntValue`/`ExtValue`/`AdditionValue` ambiguity, none of these 5
mapped fields needed an inference call.

**Scoping note — a real ambiguity, flagged not glossed over:** unlike
Surrey's form (an explicit "Tenant Improvement" checkbox), Coquitlam's form
has no dedicated TI checkbox. Project scope is selected via two *separate*
checkbox groups: building type (`Commercial`, `Institutional`, `Industrial`,
etc.) and work type (`New Building`, `Addition`, `Renovation`, `Demolition`,
`Relocating`). A commercial TI job would presumably check `Commercial` +
`Renovation`, but no City instruction was found explicitly confirming that
exact pairing — the City's own Tenant Improvements Guide PDF covers drawing
requirements only, not form-checkbox selection. The restrained field map
written to `seed.sql` doesn't touch these checkboxes at all (consistent with
every other jurisdiction here), so this doesn't block anything today, but
it's a real gap worth knowing about rather than asserting a pairing as fact.

**Filing mechanism:** Coquitlam runs **"Coquitlam QFile,"** a City-branded
electronic file-transfer service the City itself describes as accepting
"electronic applications for all permit types... 24/7." Applicants fill out
the same real PDF, then upload it (with checklists/drawings) through QFile
rather than a web-form-entry portal. Classified as `filing_mechanism:
'portal'` (closer to Toronto/Surrey/Vancouver's City-run online submission
systems than to Richmond's plain email-the-PDF flow) with a comment noting
the upload-vs-webform distinction, since the schema's `filing_mechanism` enum
(`portal` / `pdf_email` / `in_person` / `api`) has no dedicated "upload"
value.

**Status:** researched, proposed, and written to `supabase/seed.sql` plus
companion files (`docs-reference-forms/coquitlam-permit-application-form.pdf`,
`scripts/seed-storage-templates.ts`, `README.md`) in the same turn — the
user's "yes write all" covered both the research proposal and the write,
unlike Richmond's separate log-then-confirm-then-write sequence.

## 9. Port Coquitlam, BC — dedicated TI form, first real `in_person` row

Checked a few more BC candidates before this one: Kelowna (blocked by the
same bot-detection shape as vancouver.ca/winnipeg.ca, not pursued),
New Westminster (has a "Tenant Improvement Permit Application Package" but
it reads as a checklist/guide bundle, not confirmed as a distinct fillable
AcroForm -- not pursued this pass), and Abbotsford (requires creating a
"Building Permit Portal account" before application submission, suggesting
the application itself may be portal-native rather than PDF-based -- not
pursued this pass). **Port Coquitlam, BC** turned out to be the strongest of
the batch.

**Authority citation:** verified against the City's own hosted bylaw PDF
(`portcoquitlam.ca`, not a search-snippet guess) -- title text reads "This
Bylaw may be cited for all purposes as the **'Building and Plumbing Bylaw,
2009, No. 3710'**."

**Form:** a **dedicated** "Building Permit Application - Tenant Improvement"
form, linked directly from the City's live Tenant Improvement page.
Downloaded and pdf-lib-inspected: a real **74-field AcroForm, 4 pages**,
`field.isRequired()` reports `false` throughout (checked, not assumed).
Because this form is dedicated specifically to tenant improvements (not a
generic multi-purpose form like Coquitlam's, §8), there is no
building-type/work-type checkbox scoping ambiguity to flag at all -- a step
cleaner than Coquitlam's row. Restrained field map: `Applicant Name`,
`Applicant email`, `Building Site Address`, `Proposed Work`, `Estimated
Construction Value` -- all single-instance, unambiguous, no inference flag
needed. The remaining ~69 fields are mostly a 16-row `Applicant Initial N` /
`Comments N` acknowledgment table, out of scope for this restrained set.

**Filing mechanism -- our first genuine `in_person` row:** the City's own
Tenant Improvement page states the form is submitted in-person at the
Building Division offices. Checked the obvious "coming soon" trap (the same
one that caught Burnaby, §7c, and nearly caught Richmond, §7d) by directly
checking Port Coquitlam's `eApply` online portal: its own page lists exactly
which permit types it covers -- Plumbing, Fire Sprinkler, BBQ, Multi-Family,
Single-Family, Two-Family Building, and Small-Scale Multi-Unit Housing --
and states "More permit applications will be accepted online soon." Tenant
Improvement/commercial is confirmed absent from that list, so `in_person` is
a checked finding, not an assumption. This is the first time this project's
seed data has used the `in_person` value of the `filing_mechanism` enum
(defined in `20260806000004_jurisdictions_and_authorities.sql` alongside
`portal`/`pdf_email`/`api`, previously unused).

**Status:** researched, proposed, and written to `supabase/seed.sql` plus
companion files (`docs-reference-forms/port-coquitlam-ti-application.pdf`,
`scripts/seed-storage-templates.ts`, `README.md`) in the same turn, same
"yes write all" pattern as Coquitlam (§8).

## 10. Mississauga disqualified on re-check; Maple Ridge, BC shipped instead

§4/§7d had ranked Mississauga, ON as the next candidate after the BC cluster
(real 87-field AcroForm, found via an earlier pass, not yet written to
`seed.sql`). Before starting that write, re-checked it live rather than
trusting the earlier finding as still current: Mississauga's own Building
Permit Application Process page now states "All building permit
applications must be submitted online through our ePlans portal," with no
downloadable PDF application form referenced anywhere on that page or the
Building Documents and Forms page. This is the same shape that already
ruled out Burnaby (§7c, in-person-only, no PDF) and Abbotsford (§9, portal
account required before submission, application itself likely portal-native)
-- not a cheaper integration than a static AcroForm, and no PDF-fill path
for this product to build against. **Mississauga is now disqualified**,
same bar as Burnaby/Abbotsford/Technical Safety BC/Edmonton/Winnipeg; the
87-field form found in the earlier pass is stale and should not be shipped.

Checked a few Fraser Valley candidates as replacements: Delta (application
form submitted by email per `development@delta.ca`, plausible but not
pdf-lib-inspected this pass) and New Westminster (already parked at §9,
checklist bundle, not confirmed as a distinct fillable AcroForm). **Maple
Ridge, BC** turned out to be the strongest candidate checked.

**Authority citation:** verified against the City's own Building Permits &
Inspections page, which links directly to **"Building Bylaw No.
8097-2026"** -- not a search-snippet guess, and cross-confirmed on the
Commercial Renovations (Tenant/Landlord Improvement) page independently.

**Form:** a **dedicated** "Tenant/Landlord Improvement Permit Application"
form, linked directly from the City's live Commercial Renovations page.
Downloaded and pdf-lib-inspected (not inferred from a garbled text
extraction -- the raw PDF was fetched and loaded with `pdf-lib` directly):
a real **29-field AcroForm, single page**, `field.isRequired()` reports
`false` throughout (checked, not assumed). Because this form is dedicated
specifically to tenant/landlord improvements, there is no building-type/
work-type checkbox scoping ambiguity to flag, same as Port Coquitlam's row
(§9). Restrained field map: `Applicant Name`, `Applicants Email`,
`Construction Address`, `Scope of work explain in detail what you are
doing 1` (of 5 numbered lines), `Construction Value` -- all single-instance
and unambiguous, no inference flag needed, same cleanliness as Coquitlam's/
Port Coquitlam's rows. Notably, the remaining unmapped fields include an
`Over 200 amps` checkbox and `Area of 1st Floor`/`Area of 2nd Floor`/`Area
of Mezzanine or Loft`/`Total Floor Area` fields -- the closest match to
this product's own `electrical_amps`/`square_footage` extraction schema of
any jurisdiction's form inspected to date. Flagged as a good target for a
deeper field map in a future pass, not built now (same restrained-subset
discipline as every other jurisdiction here).

**Filing mechanism:** `portal`. The City's own Tenant/Landlord Improvement
page links "Apply Now" directly to the Citizen Portal
(`citizenportal.mapleridge.ca`), which requires an account and accepts
digital file uploads (drawings up to 50MB/file). This is the same
upload-based shape already used for Toronto/Coquitlam -- applicants still
fill out and submit the real PDF form above, just through the portal
instead of email/in-person -- not the Mississauga-shape disqualifier from
earlier in this section (no PDF at all, data entered natively into portal
web fields). Checked directly, not assumed from the "portal" label alone,
given this section's own finding minutes earlier that a portal can mean
either shape.

**Status:** researched, proposed, and written to `supabase/seed.sql` plus
companion files
(`docs-reference-forms/maple-ridge-tenant-landlord-improvement-application.pdf`,
`scripts/seed-storage-templates.ts`, `README.md`) in the same turn, same
"yes write all" pattern as Coquitlam/Port Coquitlam (§8/§9). New jurisdiction
id `00000000-0000-0000-0001-00000000000a` -- the first jurisdiction id in
this project to need a hex digit beyond `9`, since this is the 10th seed
jurisdiction (existing rows never needed one, running `...0001` through
`...0009`).
