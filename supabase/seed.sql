-- Phase 1 seed data. Two parts:
--   1. Reference data (jurisdictions, authorities, permit types/filings) --
--      real, from the Phase 0 research (see PHASE_0_FINDINGS.md SS3). Safe in
--      any environment, this is the public-record catalog the product ships.
--   2. LOCAL DEV / TEST FIXTURES ONLY -- two fake auth.users rows plus orgs,
--      so the tenant-isolation test (supabase/tests/tenant_isolation.test.sql)
--      has something real to run against. Never run part 2 against a shared
--      or production project.

-- ============================================================
-- PART 1: reference data
-- ============================================================

insert into jurisdictions (id, country, province_code, municipality, region, unit_system, portal_url, coverage_level, verified_at)
values
  ('00000000-0000-0000-0001-000000000001', 'CA', 'ON', 'Toronto', null, 'metric',
   'https://www.toronto.ca/services-payments/building-construction/apply-for-a-building-permit/',
   'verified', now()),
  ('00000000-0000-0000-0001-000000000002', 'CA', 'AB', 'Calgary', null, 'metric',
   'https://www.calgary.ca/development/permits.html',
   'verified', now()),
  ('00000000-0000-0000-0001-000000000003', 'CA', 'ON', 'Ottawa', null, 'metric',
   'https://ottawa.ca/en/permits-licences-and-parking',
   'assisted', null),
  ('00000000-0000-0000-0001-000000000004', 'CA', 'ON', 'Hamilton', null, 'metric',
   'https://www.hamilton.ca/build-invest-grow/building-permits',
   'listed', null),
  -- Jurisdiction-expansion follow-up (see JURISDICTION_EXPANSION_SCOPE.md):
  -- first BC jurisdiction. 'assisted', not 'verified' -- this is real,
  -- cited process/bylaw research (see the authority + permit_type comments
  -- below), not a direct BC Building Code review, same bar Ottawa/Hamilton
  -- were already held to.
  ('00000000-0000-0000-0001-000000000005', 'CA', 'BC', 'Surrey', null, 'metric',
   'https://www.surrey.ca/renovating-building-development/building/commercial-building-permits',
   'assisted', null),
  -- Jurisdiction-expansion follow-up, Vancouver pass (see
  -- JURISDICTION_EXPANSION_SCOPE.md SS4/SS5b): 'assisted', same bar as
  -- Surrey -- real, cited process/bylaw research below, not a direct code
  -- review. Vancouver is the only Canadian municipality that enacts its own
  -- building code (Vancouver Building By-law No. 14343, effective 2025-09-15,
  -- based on the 2024 BC Building Code plus Vancouver-specific provisions)
  -- rather than adopting the provincial code directly -- worth noting here
  -- since it's the reason this jurisdiction's authority isn't just "BC".
  ('00000000-0000-0000-0001-000000000006', 'CA', 'BC', 'Vancouver', null, 'metric',
   'https://vancouver.ca/home-property-development/building-permit.aspx',
   'assisted', null),
  -- Jurisdiction-expansion follow-up, Richmond pass (see
  -- JURISDICTION_EXPANSION_SCOPE.md SS7d). 'assisted', same bar as
  -- Surrey/Vancouver -- real, cited process/bylaw research below, not a
  -- direct BC Building Code + Bylaw 7230 review.
  ('00000000-0000-0000-0001-000000000007', 'CA', 'BC', 'Richmond', null, 'metric',
   'https://www.richmond.ca/business-development/building-approvals/permits.htm',
   'assisted', null),
  -- Jurisdiction-expansion follow-up, Coquitlam pass (see
  -- JURISDICTION_EXPANSION_SCOPE.md SS8). 'assisted', same bar as
  -- Surrey/Vancouver/Richmond -- real, cited process/bylaw research below,
  -- not a direct BC Building Code + Bylaw 3598 review.
  ('00000000-0000-0000-0001-000000000008', 'CA', 'BC', 'Coquitlam', null, 'metric',
   'https://www.coquitlam.ca/517/Tenant-Improvements',
   'assisted', null),
  -- Jurisdiction-expansion follow-up, Port Coquitlam pass (see
  -- JURISDICTION_EXPANSION_SCOPE.md SS9). 'assisted', same bar as
  -- Surrey/Vancouver/Richmond/Coquitlam -- real, cited process/bylaw
  -- research below, not a direct BC Building Code + Bylaw 3710 review.
  ('00000000-0000-0000-0001-000000000009', 'CA', 'BC', 'Port Coquitlam', null, 'metric',
   'https://www.portcoquitlam.ca/business-development/property-development-building/building-permits/tenant-improvement',
   'assisted', null);

-- ESA is province-wide (jurisdiction_id null), independent of any single city --
-- the concrete example SS0.6 gives for why authorities can't be nested under
-- jurisdictions.
insert into authorities (id, name, authority_level, province_code, jurisdiction_id, portal_url, filing_mechanism)
values
  ('00000000-0000-0000-0002-000000000001', 'City of Toronto - Building Division', 'municipal', 'ON',
   '00000000-0000-0000-0001-000000000001',
   'https://www.toronto.ca/services-payments/building-construction/apply-for-a-building-permit/',
   'portal'),
  ('00000000-0000-0000-0002-000000000002', 'Electrical Safety Authority (ESA)', 'agency', 'ON',
   null,
   'https://esasafe.com/fees-and-forms/forms/',
   'pdf_email'),
  ('00000000-0000-0000-0002-000000000003', 'City of Calgary - Building Permit', 'municipal', 'AB',
   '00000000-0000-0000-0001-000000000002',
   'https://www.calgary.ca/development/permits.html',
   'portal'),
  -- Surrey Building Bylaw, 2012, No. 17850 -- confirmed via the City's own
  -- Building Fee Schedule PDF, a Dec 2012 Council corporate report (RPT
  -- 2012-R256), and independent bylaw-text mirrors (Canada Commons, Policy
  -- Commons); not a search-snippet guess. filing_mechanism 'portal' matches
  -- the City's own online submission flow for commercial building permits.
  ('00000000-0000-0000-0002-000000000004', 'City of Surrey - Building Division', 'municipal', 'BC',
   '00000000-0000-0000-0001-000000000005',
   'https://www.surrey.ca/renovating-building-development/building/commercial-building-permits',
   'portal'),
  -- Vancouver Building By-law No. 14343 (confirmed on the City's own Building
  -- Permit page and its By-law page, effective 2025-09-15). filing_mechanism
  -- 'portal' matches the City's own online application flow
  -- (vancouver.ca .../building-permit.aspx), the same "CAPermitApply" portal
  -- the inspected form's own field labels reference.
  ('00000000-0000-0000-0002-000000000005', 'City of Vancouver - Development and Building Services Centre', 'municipal', 'BC',
   '00000000-0000-0000-0001-000000000006',
   'https://vancouver.ca/home-property-development/building-permit.aspx',
   'portal'),
  -- City of Richmond Building Regulation Bylaw No. 7230 (confirmed via the
  -- City's own bylaw PDF). filing_mechanism is deliberately 'pdf_email', NOT
  -- 'portal' like Surrey/Vancouver -- Richmond's MyPermit portal explicitly
  -- lists "Building Permit, Addition/Alteration, Tenant Improvement, all
  -- buildings" as "Coming Soon (2026/2027)", not yet available online. The
  -- City's own PL-59 "Electronic Building Permit Application - Quick Start
  -- Guide" (rev. Mar 10, 2026) confirms the current path: email the
  -- completed application form to BuildingApplications@richmond.ca with
  -- drawings via a file-sharing link.
  ('00000000-0000-0000-0002-000000000006', 'City of Richmond - Building Approvals', 'municipal', 'BC',
   '00000000-0000-0000-0001-000000000007',
   'https://www.richmond.ca/business-development/building-approvals.htm',
   'pdf_email'),
  -- City of Coquitlam Building Bylaw No. 3598, 2003 (confirmed via the City's
  -- own consolidated bylaw text, publicdocs.coquitlam.ca, title page reads
  -- "CITY OF COQUITLAM BUILDING BYLAW NO. 3598, 2003" -- not a search-snippet
  -- guess). filing_mechanism is 'portal': the City runs "Coquitlam QFile," a
  -- City-branded electronic file-transfer service it describes as accepting
  -- "electronic applications for all permit types... 24/7" -- closer to
  -- Toronto/Surrey/Vancouver's City-run online submission systems than to
  -- Richmond's plain email-the-PDF flow. Worth noting the distinction though:
  -- QFile is a document-upload channel, not a web-form-data-entry portal --
  -- applicants still fill out and submit the same real PDF below, just
  -- through QFile instead of an email address.
  ('00000000-0000-0000-0002-000000000007', 'City of Coquitlam - Building Permits Division', 'municipal', 'BC',
   '00000000-0000-0000-0001-000000000008',
   'https://www.coquitlam.ca/478/Building-Construction',
   'portal'),
  -- City of Port Coquitlam Building and Plumbing Bylaw, 2009, No. 3710
  -- (confirmed via the City's own hosted bylaw PDF, title text reads "This
  -- Bylaw may be cited for all purposes as the 'Building and Plumbing
  -- Bylaw, 2009, No. 3710'" -- not a search-snippet guess). filing_mechanism
  -- is 'in_person' -- our first real use of that enum value: the City's own
  -- Tenant Improvement page states the form is submitted in-person at the
  -- Building Division offices, and the City's "eApply" online portal
  -- explicitly does NOT cover Tenant Improvement/commercial permits (its own
  -- page lists covered types -- Plumbing, Fire Sprinkler, BBQ, Multi/Single/
  -- Two-Family Building, Small-Scale Multi-Unit Housing -- and says "More
  -- permit applications will be accepted online soon"). Checked, not
  -- assumed, same "coming soon" trap that caught Richmond's/Burnaby's
  -- portal evaluations (SS7c/SS7d).
  ('00000000-0000-0000-0002-000000000008', 'City of Port Coquitlam - Building Division', 'municipal', 'BC',
   '00000000-0000-0000-0001-000000000009',
   'https://www.portcoquitlam.ca/business-development/property-development-building/building-permits/tenant-improvement',
   'in_person');

-- Demonstrates the multi-authority filing model end to end (SS0.6): a Toronto
-- electrical service upgrade needs a City of Toronto building permit ONLY when
-- it triggers a structural/enclosure change, and an ESA notification always --
-- two authorities, one permit type, order matters for the wizard's package output.
insert into permit_types (id, jurisdiction_id, title, required_form_template_path, compliance_rules, version, verified_at, verified_by)
values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000001',
   'Electrical Service Upgrade', 'toronto/permit-to-construct-or-demolish.pdf',
   '{"requires_document_kinds": ["scope_of_work"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000002',
   'Commercial Tenant Improvement', 'calgary/commercial-building-project-application.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  -- Same title as Calgary's row, deliberately: this is Surrey's real
  -- "Tenant and Landlord Improvement Building Permit"
  -- (surrey.ca/.../tenant-and-landlord-improvement-building-permit), scoped
  -- to the tenant-improvement side only -- landlord improvement (base
  -- building work by the property owner, a different trigger/audience) is
  -- NOT covered by this row. Surrey requires a Coordinating Registered
  -- Professional (Architect/AIBC or Engineer/EGBC) on these applications
  -- per the City's own checklist (tenant-landlord-improvement-checklist.pdf)
  -- -- a real process requirement, not yet encoded as an enforced
  -- compliance_rules key since the app doesn't check for one today; noted
  -- here so it isn't lost.
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0001-000000000005',
   'Commercial Tenant Improvement', 'surrey/building-permit-application.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  -- Vancouver's general "Development and Building Permit Application" form
  -- (docs-reference-forms/vancouver-dev-build-app-form.pdf, 158 real AcroForm
  -- fields) covers this row's scope. Deliberately NOT the same as Vancouver's
  -- separate "Tenant Improvement Program (TIPs)" -- that's a narrower,
  -- dedicated fast-track review stream for office tenants in eligible
  -- buildings (any commercial office building permitted after 2007-01-31),
  -- confirmed on the City's own TIPs program page, and is out of scope for
  -- this general-path row. Also deliberately NOT Vancouver's separate
  -- "Certified Professional" building-permit form (cp-building-permit-app.pdf,
  -- 105 fields) -- that's a parallel expedited-review track requiring a
  -- pre-qualified Certified Professional, a different filing path than the
  -- general one modeled here.
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0001-000000000006',
   'Commercial Tenant Improvement', 'vancouver/dev-build-app-form.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  -- Richmond's PL-43 "Building Permit Application Form - Addition and
  -- Alterations" (jurisdiction-expansion follow-up, JURISDICTION_EXPANSION_SCOPE.md
  -- SS7d) -- confirmed via the City's own "Commercial TI Building Permit
  -- Requirements" page as the specific form linked for this permit type, and
  -- confirmed via the MyPermit portal's "Coming Soon (2026/2027)" listing to
  -- still be the live, primary submission path (see the authorities row's
  -- comment above).
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0001-000000000007',
   'Commercial Tenant Improvement', 'richmond/building-permit-application-addition-alterations.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  -- Coquitlam's general "Permit Application Form" (jurisdiction-expansion
  -- follow-up, JURISDICTION_EXPANSION_SCOPE.md SS8) -- linked directly from
  -- the City's own live "Tenant Improvements" page, same as every other row
  -- here. Scoping note: unlike Surrey's form (an explicit "Tenant
  -- Improvement" checkbox), Coquitlam's form has no dedicated TI checkbox --
  -- project type is selected via two separate checkbox groups, building type
  -- (Commercial/Institutional/Industrial/etc.) and work type (New
  -- Building/Addition/Renovation/Demolition/Relocating), so a commercial TI
  -- job would presumably check "Commercial" + "Renovation". No City
  -- instruction found explicitly confirming that exact pairing (the City's
  -- own TI-specific guide covers drawing requirements only, not
  -- form-checkbox selection) -- flagged as a real ambiguity, not silently
  -- assumed as fact. Consistent with every other jurisdiction here, the
  -- restrained field map below doesn't touch these checkboxes at all.
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0001-000000000008',
   'Commercial Tenant Improvement', 'coquitlam/permit-application-form.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed'),
  -- Port Coquitlam's dedicated "Building Permit Application - Tenant
  -- Improvement" form (jurisdiction-expansion follow-up,
  -- JURISDICTION_EXPANSION_SCOPE.md SS9) -- linked directly from the City's
  -- own live Tenant Improvement page. Unlike Coquitlam's generic
  -- multi-purpose form (SS8), this is a form dedicated specifically to
  -- tenant improvements, so there's no building-type/work-type checkbox
  -- scoping ambiguity to flag here at all.
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0001-000000000009',
   'Commercial Tenant Improvement', 'port-coquitlam/building-permit-application-tenant-improvement.pdf',
   '{"requires_document_kinds": ["scope_of_work", "blueprint"]}'::jsonb,
   1, now(), 'phase-1-seed');

-- Explicit ids (Phase 4) so permit_form_fields rows below can reference a
-- specific filing -- 20260806000017 re-scopes field maps from permit_type_id
-- to permit_type_filing_id (each authority's own form needs its own map).
-- form_template_path is set per filing now, not just per permit_type: it's
-- the same PDF as the permit_type's own required_form_template_path for
-- Toronto/Calgary today (one filing per permit_type there), but the whole
-- point of moving it here is Electrical Service Upgrade's ESA filing, which
-- needs a genuinely different file (docs-reference-forms/esa-icia-low-voltage.pdf,
-- a flat/non-AcroForm export -- Phase 0 finding).
insert into permit_type_filings (id, permit_type_id, authority_id, sequence, is_conditional_on, form_template_path)
values
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0002-000000000001', 1,
   '{"trigger": "structural_or_enclosure_change"}'::jsonb, 'toronto/permit-to-construct-or-demolish.pdf'),
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0002-000000000002', 2, null,
   'esa/icia-low-voltage.pdf'),
  ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0002-000000000003', 1, null,
   'calgary/commercial-building-project-application.pdf'),
  -- Surrey uses one generic multi-purpose "Building Permit Application"
  -- form for New Building/Addition/Exterior Renovation/Tenant
  -- Improvement/Landlord Improvement/Demolition alike (a "Tenant
  -- Improvement" checkbox selects the project type on the same document) --
  -- unlike Toronto's dedicated per-permit-type form, so a single
  -- unconditional filing, not a multi-authority/conditional chain.
  ('00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0002-000000000004', 1, null,
   'surrey/building-permit-application.pdf'),
  -- Vancouver's general Development and Building Permit Application form
  -- covers this permit_type end to end -- one authority, one filing, same
  -- unconditional shape as Surrey's row above.
  ('00000000-0000-0000-0004-000000000005', '00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0002-000000000005', 1, null,
   'vancouver/dev-build-app-form.pdf'),
  -- Richmond's PL-43 form covers this permit_type end to end -- one
  -- authority, one filing, same unconditional shape as Surrey/Vancouver's
  -- rows above. filing_mechanism on the authority row is 'pdf_email', not
  -- 'portal' -- see that row's comment.
  ('00000000-0000-0000-0004-000000000006', '00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0002-000000000006', 1, null,
   'richmond/building-permit-application-addition-alterations.pdf'),
  -- Coquitlam's Permit Application Form covers this permit_type end to end --
  -- one authority, one filing, same unconditional shape as
  -- Surrey/Vancouver/Richmond's rows above.
  ('00000000-0000-0000-0004-000000000007', '00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0002-000000000007', 1, null,
   'coquitlam/permit-application-form.pdf'),
  -- Port Coquitlam's dedicated Tenant Improvement application form covers
  -- this permit_type end to end -- one authority, one filing, same
  -- unconditional shape as Surrey/Vancouver/Richmond/Coquitlam's rows above.
  ('00000000-0000-0000-0004-000000000008', '00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0002-000000000008', 1, null,
   'port-coquitlam/building-permit-application-tenant-improvement.pdf');

-- Field maps, from the Phase 0 pdf-lib inspection (PHASE_0_FINDINGS.md SS4):
-- Toronto's form has real AcroForm fields, so its 3 rows below use
-- pdf_field_name and were hand-verified against the actual field names
-- pdf-lib reported for docs-reference-forms/toronto-permit-application.pdf.
--
-- Deliberately NO rows here for the ESA filing (00000000-0000-0000-0004-
-- 000000000002) or Calgary (...003): ESA's ICIA-LV form has zero AcroForm
-- fields (Phase 0 finding) and would need the coordinate-overlay columns
-- instead, but overlay_x/overlay_y are real PDF pixel coordinates that must
-- come from actually measuring the rendered form -- Phase 0's research did
-- not include that measurement step, and fabricating plausible-looking
-- coordinates for a real government form here would misrepresent them as
-- verified when they are not (the same "never assert what you haven't
-- checked" discipline this system enforces on the AI audit engine, SS0.2,
-- applied to seed data). Calgary's own 15-field AcroForm was also flagged in
-- Phase 0 as needing a manual page-by-page review before its field map can
-- be trusted (it looks like a bundled multi-purpose PDF). Both are tracked
-- as a known Phase 4 limitation (see README) rather than silently faked; the
-- coordinate-overlay code path itself is still exercised, but against a
-- synthetic test-only fixture PDF with arbitrary coordinates
-- (eval/fixtures/overlay-test-form.ts), never against these real forms'
-- actual coordinates until someone has verified them by hand.
-- permit_type_id is still populated too (that column stays NOT NULL --
-- 20260806000017 added permit_type_filing_id additively without touching
-- it): both point at the same Electrical Service Upgrade permit_type here
-- since Toronto's filing hasn't diverged from it, but permit_type_filing_id
-- is what Phase 4's application code actually reads.
insert into permit_form_fields (permit_type_id, permit_type_filing_id, pdf_field_name, maps_to, is_required, overlay_page, overlay_x, overlay_y)
values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', 'Applicant Last name', 'applicant.lastName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', 'Applicant First name', 'applicant.firstName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0004-000000000001', 'Project value estimated (in dollars)', 'application.estimatedJobValueDollars', true, null, null, null),
  -- Surrey's BuildingPermitApplication.pdf is a real 80-field AcroForm
  -- (jurisdiction-expansion follow-up, pdf-lib inspection --
  -- JURISDICTION_EXPANSION_SCOPE.md SS3), hand-verified field names below.
  -- Restrained subset, same discipline as Toronto's 3-of-many rows above --
  -- not attempting all 80. is_required here is a product judgment (this
  -- data is plainly necessary for any application), same basis as Toronto's
  -- rows: pdf-lib's own field.isRequired() reports false for every field on
  -- this form (the AcroForm itself doesn't encode requiredness -- checked,
  -- not assumed), so unlike the bylaw citation this column isn't
  -- PDF-sourced fact.
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0004-000000000004', 'Applicant', 'applicant.fullName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0004-000000000004', 'ApplicantEmail', 'applicant.email', true, null, null, null),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0004-000000000004', 'Project Address', 'application.projectAddress', true, null, null, null),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0004-000000000004', 'Construction Value', 'application.estimatedJobValueDollars', true, null, null, null),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0004-000000000004', 'DescriptionOfProposedWork', 'application.projectDescription', false, null, null, null),
  -- Vancouver's dev-build-app-form.pdf is a real 158-field AcroForm
  -- (jurisdiction-expansion follow-up, pdf-lib inspection --
  -- JURISDICTION_EXPANSION_SCOPE.md SS4), hand-verified field names below.
  -- Restrained subset, same discipline as Toronto/Surrey above. Like
  -- Surrey's form, pdf-lib's field.isRequired() reports false for every
  -- field here too (checked, not assumed) -- is_required below is again a
  -- product judgment, not a PDF-sourced fact.
  --
  -- Lower-confidence flag: the form repeats the same contact-block fields
  -- (name/address/phone/email) seven times for different roles (Applicant,
  -- Owner, Contractor, etc.), distinguished only by a numeric suffix
  -- (_2 through _7) with no on-form section label recoverable without an
  -- OCR/layout tool this environment doesn't have (same limitation hit on
  -- Surrey's form). The mapping below assumes the FIRST, unsuffixed block is
  -- "Applicant" based on field order alone -- it directly follows the
  -- "Permit account email" field, which is itself labelled as the email used
  -- to log into the City's own CAPermitApply portal. This is an inference,
  -- not a verified label; flagged here rather than silently presented as
  -- fact, per this session's proposal to the user.
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0004-000000000005', 'Permit account email The one you use to log into vancouvercapermitapply', 'applicant.email', true, null, null, null),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0004-000000000005', 'First name', 'applicant.firstName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0004-000000000005', 'Last name', 'applicant.lastName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0004-000000000005', 'Address and street name', 'application.projectAddress', true, null, null, null),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0004-000000000005', 'Estimated value of building construction including cost of plans materials labour', 'application.estimatedJobValueDollars', true, null, null, null),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0004-000000000005', 'Describe the proposed work', 'application.projectDescription', false, null, null, null),
  -- Richmond's PL-43 "Building Permit Application Form - Addition and
  -- Alterations" is a real 117-field AcroForm (jurisdiction-expansion
  -- follow-up, pdf-lib inspection -- JURISDICTION_EXPANSION_SCOPE.md SS7d),
  -- hand-verified field names below. Restrained subset, same discipline as
  -- Toronto/Surrey/Vancouver above. Like those forms, pdf-lib's
  -- field.isRequired() reports false for every field here too (checked, not
  -- assumed) -- is_required below is again a product judgment, not a
  -- PDF-sourced fact.
  --
  -- Lower-confidence flag: the form has three separate dollar-value fields
  -- (IntValue, ExtValue, AdditionValue) without a directly adjacent on-form
  -- label recoverable in this environment. IntValue is used below as the
  -- best-inference match for "estimated job value" based on field order
  -- (it's the first of the three, directly following the work-description
  -- block) and its name reading as "interior [construction] value" for an
  -- interior tenant-improvement scope -- ExtValue ("exterior") and
  -- AdditionValue (building additions) both read as out of scope for a pure
  -- TI job. This is an inference, not a verified label; flagged here rather
  -- than silently presented as fact, per this session's proposal to the
  -- user.
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0004-000000000006', 'ApplName', 'applicant.fullName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0004-000000000006', 'ApplEmail', 'applicant.email', true, null, null, null),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0004-000000000006', 'ProjectStreetAddr', 'application.projectAddress', true, null, null, null),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0004-000000000006', 'WorkDesc', 'application.projectDescription', false, null, null, null),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0004-000000000006', 'IntValue', 'application.estimatedJobValueDollars', true, null, null, null),
  -- Coquitlam's Permit Application Form is a real 95-field AcroForm
  -- (jurisdiction-expansion follow-up, pdf-lib inspection --
  -- JURISDICTION_EXPANSION_SCOPE.md SS8), hand-verified field names below.
  -- Restrained subset, same discipline as Toronto/Surrey/Vancouver/Richmond
  -- above. Like those forms, pdf-lib's field.isRequired() reports false for
  -- every field here too (checked, not assumed) -- is_required below is
  -- again a product judgment, not a PDF-sourced fact.
  --
  -- Unlike Vancouver's repeated contact blocks or Richmond's ambiguous
  -- multi-value fields, this form's 5 mapped fields are single-instance and
  -- unambiguously named -- no inference flag needed for this row, unlike
  -- every other jurisdiction added since Toronto.
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0004-000000000007', 'Applicant Name', 'applicant.fullName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0004-000000000007', 'Applicant Email Address', 'applicant.email', true, null, null, null),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0004-000000000007', 'Site Address', 'application.projectAddress', true, null, null, null),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0004-000000000007', 'Summary of Project Proposed', 'application.projectDescription', false, null, null, null),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0004-000000000007', 'Construction Value', 'application.estimatedJobValueDollars', true, null, null, null),
  -- Port Coquitlam's dedicated Tenant Improvement application form is a real
  -- 74-field AcroForm (jurisdiction-expansion follow-up, pdf-lib inspection
  -- -- JURISDICTION_EXPANSION_SCOPE.md SS9), hand-verified field names
  -- below. Restrained subset, same discipline as every jurisdiction above.
  -- pdf-lib's field.isRequired() reports false for every field here too
  -- (checked, not assumed) -- is_required below is again a product
  -- judgment, not a PDF-sourced fact.
  --
  -- Like Coquitlam's row, this form's 5 mapped fields are single-instance
  -- and unambiguously named -- no inference flag needed. The remaining ~69
  -- fields are mostly a 16-row "Applicant Initial N" / "Comments N"
  -- acknowledgment table, out of scope for this restrained set.
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0004-000000000008', 'Applicant Name', 'applicant.fullName', true, null, null, null),
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0004-000000000008', 'Applicant email', 'applicant.email', true, null, null, null),
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0004-000000000008', 'Building Site Address', 'application.projectAddress', true, null, null, null),
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0004-000000000008', 'Proposed Work', 'application.projectDescription', false, null, null, null),
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0004-000000000008', 'Estimated Construction Value', 'application.estimatedJobValueDollars', true, null, null, null);

-- ============================================================
-- PART 2: LOCAL DEV / TEST FIXTURES ONLY -- do not run against a shared project
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated',
   'org-a-owner@example.test', 'not-a-real-hash-local-dev-only',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated',
   'org-b-owner@example.test', 'not-a-real-hash-local-dev-only',
   now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, false, false)
on conflict (id) do nothing;

insert into organizations (id, name) values
  ('20000000-0000-0000-0000-00000000000a', 'Org A - Test Mechanical Ltd.'),
  ('20000000-0000-0000-0000-00000000000b', 'Org B - Test Electrical Inc.');

insert into org_members (org_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'owner');

insert into contractors (id, org_id, company_name, primary_license_number, license_province_code) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A Test Mechanical Ltd.', 'ON-ECRA-000001', 'ON'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B Test Electrical Inc.', 'ON-ECRA-000002', 'ON');

-- permit_status is explicit here (Gate 1.3 review), not left to
-- permit_status_enum's column default. 'intake' is still the CORRECT value
-- for these two rows -- they mirror the pipeline `status = 'draft'` fixture
-- state, i.e. "created, nothing has happened in either machine yet" -- this
-- isn't fixing a wrong value, it's removing a silent dependency on the
-- default: if a future migration ever changes permit_status's default, an
-- implicit-default fixture row would reinterpret itself without anyone
-- touching this file, which is exactly the kind of drift an explicit value
-- prevents.
--
-- project_id (Gate 1.3 review, round 2): these two fixtures get a REAL
-- project_id below, pointing at ordinary (non-'backfill') projects created
-- in this file -- not left null for
-- 20260806000023_backfill_permit_application_project_id.sql to catch.
-- `supabase db reset` applies every migration before running this file, so
-- a row inserted here can never be seen by that migration's backfill loop
-- (it only scans rows that already exist at migration-apply time) -- an
-- orphan created here would stay an orphan forever, not get backfilled on
-- the next reset. That was harmless while project_id was nullable, but
-- once 20260806000023b (supabase/migrations_blocked/) ships and makes
-- project_id NOT NULL, a seed.sql that still inserts an orphan here would
-- make `db reset` itself fail outright. Fixing it now, while it's a
-- two-line change, avoids that becoming an emergency in an unrelated
-- future gate.
insert into projects (id, org_id, title, status) values
  ('50000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Org A - 200A Service Upgrade', 'draft'),
  ('50000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Org B - 400A Service Upgrade', 'draft');

insert into permit_applications (id, org_id, project_id, contractor_id, permit_type_id, project_title, project_address, status, permit_status, estimated_job_value_cents, currency_code) values
  ('40000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0003-000000000001', 'Org A - 200A Service Upgrade', '123 Test St, Toronto, ON', 'draft', 'intake', 1250000, 'CAD'),
  ('40000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0003-000000000001', 'Org B - 400A Service Upgrade', '456 Test Ave, Toronto, ON', 'draft', 'intake', 3400000, 'CAD');

-- Lifecycle & Compliance Expansion, Phase 1.1 (20260806000019): Org A/B
-- predate create_organization_with_owner()'s taxonomy-seeding extension (that
-- RPC only seeds NEW orgs going forward), so backfill the same five
-- 'project_type' rows here to keep the fixtures consistent with what a
-- freshly created org would have. `on conflict do nothing` against
-- taxonomies' `unique (org_id, kind, code)` makes this safe to re-run.
insert into taxonomies (org_id, kind, code, label, sort_order, is_seed) values
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'new_construction', 'New Construction', 1, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'renovation', 'Renovation', 2, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'addition', 'Addition', 3, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'repair', 'Repair', 4, true),
  ('20000000-0000-0000-0000-00000000000a', 'project_type', 'demolition', 'Demolition', 5, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'new_construction', 'New Construction', 1, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'renovation', 'Renovation', 2, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'addition', 'Addition', 3, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'repair', 'Repair', 4, true),
  ('20000000-0000-0000-0000-00000000000b', 'project_type', 'demolition', 'Demolition', 5, true)
on conflict (org_id, kind, code) do nothing;
