# Gate 3.0 Findings — Scoping (Read-Only)

**Status:** investigation complete, zero implementation. This document is the deliverable in full —
no migration, component, Server Action, RLS policy, or code of any kind was added to the repository
to produce it. `AGENTS.md` was not touched. Every claim below is either a direct citation to a file
already in this repo, or explicitly marked as this document's own recommendation, per
`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:49` ("Every factual claim in this document must
carry a `path/to/file.ts:L120-L145` citation... If you cannot find something, write **NOT FOUND**").

**There is no `APPROVED: PHASE 3.0` token and this document does not self-issue one**, per
`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:17` ("You may not begin a phase until I reply with
the exact token `APPROVED: PHASE <n>` on its own line").

---

## §A. Which case Gate 3.0 is in — the first deliverable

The scoping prompt that produced this document offered two cases: fully specified like Gates
1.0–1.7, or a one-row stub like Gate 2.0 was before `GATE_2_0_SPEC.md` existed. **Gate 3.0 is
neither. It is a third, more minimal case: Gate 3.0 has no table row, no subsection, and no
rationale paragraph anywhere in the master prompt. It exists only as one item inside a
parenthetical list of five phases that the master prompt explicitly defers to a document —
"the original brief" — that `PHASE_0_FINDINGS.md` §S.1 already proved, by exhaustive in-repo
search, does not exist anywhere in this engagement.**

This is a materially smaller starting point than Gate 2.0 had. Gate 2.0's one line
(`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:118`) was still a table row with a scope
description and a flag name, plus a dedicated rationale paragraph
(`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:120`) explaining *why* it was carved out and what
it must not do in the meantime. Gate 3.0 has none of that apparatus. It has a name inside a list,
and an instruction not to touch it:

> "Phases 3–7 (corrections/resubmissions, inspections/closeout, licence & expiration/renewal,
> permit intelligence, integrations) stay exactly as scoped in the original brief. **Do not
> implement, scaffold, stub, or add columns for them.**"
> — `docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:122`

Reading the §2 table's own ordering (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:108-118`,
gates numbered 1.0 through 2.0 in sequence), "Gate 3.0" is the first item in that parenthetical
list: **corrections/resubmissions**. That reading is not stated anywhere in the document as a
number — it is inferred from position, and is flagged here as an inference, not a citation, per
this document's own discipline (§A of this document is itself the first finding this rule applies
to; see §G below).

**Consequence for everything that follows.** The scoping prompt's instruction was: "That
determines everything else." Since Gate 3.0 is not a stub with a rationale to expand, but a bare
name pointing at a document proven not to exist, this document cannot produce a sub-phase table
with per-migration blast radius the way `GATE_2_0_FINDINGS.md` §F could — that section had an
actual design (§A–§E of that document) to break into sub-phases. There is no design here to break
apart. §F below states this plainly rather than inventing sub-phase boundaries to fill the
requested shape.

---

## §B. What Gate 3.0 is, per everything actually in this repo

Two places in the master prompt touch corrections/resubmissions, and neither is a specification:

1. **§2's deferral list** (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:122`, quoted in full
   above) — names it, defers it, prohibits scaffolding it.
2. **§0.2's product boundary statement** (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:31`):

   > `Project Intake → Jurisdiction Identification → Permit Requirement Determination → Document
   > Collection → Application Readiness Review → Submission → Municipal Review → Corrections &
   > Resubmission → Permit Issuance → Inspections → Final Approval → Closeout or Renewal`

   This is the only place the master prompt describes what "corrections/resubmissions" *means* as
   a product concept: the stage between a municipal reviewer sending an application back and the
   org getting it re-submitted. It is one arrow in a workflow diagram, not a spec — no fields, no
   states, no tables, no roles, no UI description. It confirms the concept is real and load-bearing
   to the product (it sits directly in the core workflow §0.2 defines as PermitField OS's entire
   product boundary), which is precisely why deferring it entirely to a nonexistent document is
   worth flagging rather than working around.

`PHASE_0_FINDINGS.md` has no section on corrections/resubmissions at all — confirmed by grep
(`grep -in "correction\|resubmission" PHASE_0_FINDINGS.md`, matches only inside quotations of
`docs/STATUS_TRANSITIONS.md`-style enum names, none of them an independent analysis section the
way §E or §S.1 are for their own topics). Phase 0 was scoped to Gates 1.0–1.7 and did not audit
Gate 3.0 territory, which is consistent with the master prompt's own instruction not to scaffold it.

**"The original brief" does not exist in this repository.** This document reuses
`PHASE_0_FINDINGS.md` §S.1's finding directly rather than re-running the same search and getting a
different answer by coincidence: §S.1 (`PHASE_0_FINDINGS.md:1492-1523`) checked
`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md` itself, `PHASE_0_FINDINGS_ORIGINAL_MISSION.md`,
`PHASE_0_FINDINGS.md` itself, and `README.md` — no panel/spec content in any of them relevant to
its own topic (dashboard panels). This document re-ran the same four-location check for
corrections/resubmissions content specifically and found the same result: nothing in any of the
four. `PHASE_0_FINDINGS_ORIGINAL_MISSION.md` was independently confirmed earlier in this
engagement to be an unrelated document — a different, prior mission's environment/workspace audit,
not a product brief (`PHASE_0_FINDINGS_ORIGINAL_MISSION.md:1-80`, no product/UI/phase-3-7 content).
There is no fifth location to check that either §S.1 or this document has not already ruled out.

**Finding B.1 — "the original brief" is cited as the source of Gate 3.0's specification and does
not exist anywhere in this engagement.** Owning sub-phase: none — this is not a forward action
assignable to a future sub-phase of Gate 3.0, because there is no Gate 3.0 sub-phase structure yet
(see §A). It is a standing precondition: no sub-phase of Gate 3.0 can be scoped from "the original
brief" until that document is supplied from outside this repository, or the user chooses to write
an in-repo spec the way `GATE_2_0_SPEC.md` was written for Gate 2.0 after its own one-line start.

---

## §C. What Gate 2.0 left behind — what Gate 3.0 would depend on if it existed

The scoping prompt requires this section explicitly. Every claim below is reverified in this repo
today (commit `e91ca66`, per this session's own merge), not carried forward from memory of the
Gate 2.0 retrofit.

**C.1 — The bridge library is a dependency nothing calls.**
`grep -rln "bridge/client-portal\|client-portal-service-client" app/` returns zero matches. Every
one of the five read operations plus `uploadDocument` in `lib/bridge/client-portal.ts` exists as
code with zero live callers anywhere under `app/`. If a future Gate 3.0 sub-phase intends the org
side of a correction/resubmission flow to surface anything through the client portal (e.g. a client
seeing "revision requested" and re-uploading a document), that entire call path does not exist yet
— not disabled, not flag-gated-off-but-wired, genuinely unwritten. **This is not a Gate 3.0 blocker
by itself** — corrections/resubmissions could plausibly be entirely staff-side (an org's own
`permit_manager`/`permit_coordinator` recording a jurisdiction's decision) with no client-portal
involvement at all — but it is a dependency that must be explicitly ruled in or out before any
Gate 3.0 sub-phase is scoped, because the master prompt gives no basis to assume either way.

**C.2 — `GATE_2_0_SPEC.md` §7's five items are still open**, current status per that file as merged
this session (`GATE_2_0_SPEC.md:873-940`):
- Default token TTL — unassigned, deferred (`GATE_2_0_SPEC.md:886-891`).
- Staff-facing issuance/revocation UI and its role gate — unassigned, deferred
  (`GATE_2_0_SPEC.md:900-903`).
- Rate limiting / abuse handling on token validation — unassigned, deferred, and explicitly noted
  as moot today since nothing calls `resolveToken` live (`GATE_2_0_SPEC.md:911-915`, consistent
  with C.1 above).
- Second Supabase project's own infrastructure (hosting, billing, backup/DR) — not a Claude-owned
  deliverable; the user's own stated responsibility (`GATE_2_0_SPEC.md:921-926`, citing
  `GATE_2_0_FINDINGS.md` §L.3's direct quote).
- Staff-facing read path for `client_access_log` — unassigned, deferred, no owner named
  (`GATE_2_0_SPEC.md:937-940`).

None of these were owned by any of Gate 2.0's sub-phases 2.1–2.5 to begin with (four were "never
assigned," not "missed" — `GATE_2_0_SPEC.md:886-940` throughout), so §N's orphan pattern does not
apply to them the way it applied to J.3/K.3. They are simply still-open gaps, four of them with no
owner named anywhere, one explicitly not Claude's to schedule. If Gate 3.0 needs any of these
(issuance/revocation UI, in particular, would plausibly matter for a client-facing corrections flow
if C.1 resolves toward "yes, client portal is involved"), that need does not create an owner by
itself — one still has to be assigned.

**C.3 — Credential isolation's binary trigger is unpulled, and the underlying fact it depends on is
unchanged.** `GATE_2_0_SPEC.md:634-642` states the trigger condition plainly: "Before any real,
non-local project-2 `service_role` credential is provisioned into any environment reachable by the
main app's runtime — staging included — mechanism 2 must exist first, or the single-layer state
... must be re-justified in writing." Reverified today: `.env.example` still carries only empty
placeholders for both client-portal Supabase variables (`grep -n "CLIENT_PORTAL" .env.example` →
`CLIENT_PORTAL_SUPABASE_URL=`, `CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY=`, both unset,
`PERMITFIELD_FF_CLIENT_PORTAL=false`), and no deploy target exists for either project
(`GATE_2_0_SPEC.md:612-623`: "no `vercel.json`, no 'deploy'/'vercel' step in
`.github/workflows/ci.yml`, no `output` mode set in `next.config.ts`" — reconfirmed unchanged this
session, no new deploy config was added by the closure retrofit, which touched only two `.md`
files). The trigger has not fired. This matters to Gate 3.0 only insofar as Gate 3.0 might also
touch the client portal (see C.1) — if it does not, this item is inherited context, not a blocker.

**C.4 — No live second project, no deploy target of any kind, for either project.** Same citations
as C.3. This is the most basic infrastructure fact carried forward: even setting aside whether
Gate 3.0 needs the client portal specifically, nothing in this repo runs anywhere outside local
development and CI today. Any Gate 3.0 sub-phase that assumes a deployed, reachable environment
(for example, a corrections-notification email or a jurisdiction-facing webhook) would need that
built first, and it is not scoped anywhere — not in Gate 2.0, not in this document, not in the
master prompt.

**Finding C.5 — none of C.1–C.4 individually blocks Gate 3.0; together they mean "corrections/
resubmissions" cannot be scoped as a client-portal-dependent feature without first deciding
whether it is one.** Owning sub-phase: none yet — this is a scoping decision that has to precede
sub-phase assignment, not a task a sub-phase can pick up. See §E.

---

## §D. Existing groundwork that already overlaps this subject matter — named, not resolved

This is the tension the scoping prompt asked to be surfaced rather than silently resolved
(`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:24`, rule 8: "Stop and ask... Do not resolve it
silently in either direction").

**Gate 1.3 already modeled three correction/resubmission states directly in the database**, ahead
of any Gate 3.0 specification existing:

- `permit_status_enum` includes `revision_requested`, `resubmitted`, `appeal_filed`
  (`supabase/migrations/20260806000022_permit_status_machine.sql:90-107`), sitting in the
  `jurisdiction_outcome` tier alongside `approved`/`rejected`/`issued`/`expired`/`closed`
  (`docs/STATUS_TRANSITIONS.md:46`).
- `docs/STATUS_TRANSITIONS.md:55-66` documents why these three names were chosen and attributes the
  requirement directly to the master prompt's own spec language for Gate 1.3: "the master prompt's
  spec calls for 16 total statuses and describes the `jurisdiction_outcome` tier as 'approved,
  rejected, issued, expired, closed, plus any correction/resubmission states in the 16,' leaving the
  exact 3 remaining names to this gate's judgment." That spec language is Gate 1.3's own
  (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md` §3.3, permit applications/status machine), not a
  citation to a corrections/resubmissions gate that doesn't exist — Gate 1.3 was explicitly told to
  reserve room in the 16-value enum for this concept, without being told this concept would later be
  its own out-of-scope gate.
- The transition table (`permit_status_transitions`,
  `supabase/migrations/20260806000022_permit_status_machine.sql:179-183`) and its full legal-move
  graph (`docs/STATUS_TRANSITIONS.md:68-129`) already define which states can legally precede and
  follow `revision_requested`/`resubmitted`/`appeal_filed`.
- Three "evidence columns" (`permit_number`, `decision_date`, `decision_document_id`) were added in
  the same migration, explicitly unenforced and explicitly flagged as intended for a **future gate**
  to constrain: "added now, NOT enforced in this gate (explicit user instruction — 'add the columns
  now so the later constraint is additive')... a future gate is expected to add one once the
  application layer actually collects this evidence"
  (`supabase/migrations/20260806000022_permit_status_machine.sql:135-140`). This is the single most
  direct piece of evidence in the repo that whoever scoped Gate 1.3 anticipated a later gate — very
  plausibly this one — picking this up.
- Zero application-layer consumer exists for any of it: no UI in `app/` reads or writes
  `permit_status` at all (`docs/STATUS_TRANSITIONS.md:242-244`, "No UI reads or writes
  `permit_status` anywhere in `app/`"), and a direct repo search
  (`grep -rln "revision_requested\|appeal_filed" app/ lib/`) returns exactly one file:
  `lib/permit-status/transitions.ts` itself — the transition table's own TypeScript mirror, not a
  consumer. The three correction states are reachable today only by calling
  `transition_permit_status()` directly with no route, Server Action, or UI surface that would ever
  do so.

**The tension, stated plainly rather than resolved:** the master prompt's own product-boundary
diagram (§0.2, `docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:31`) treats "Corrections &
Resubmission" as a real stage of the one workflow this product exists to manage, and Gate 1.3
already built schema-level infrastructure that names that exact stage — three enum values, a
transition graph, and evidence columns explicitly commented as reserved for "a future gate." At the
same time, §2's deferral list (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:122`) treats
"corrections/resubmissions" as unscoped work belonging to a document that does not exist, and
explicitly prohibits scaffolding, stubbing, or adding columns for it. Both statements are true
simultaneously only because Gate 1.3's status-machine columns were framed as belonging to Gate 1.3
itself (a specified, approved gate) rather than as scaffolding for the deferred gate — a framing
this document is not in a position to validate or overturn, since it depends on intent the master
prompt does not record anywhere citable.

**This document takes no position on which of the following is true, and states both rather than
picking one:**
1. Gate 1.3's three states and evidence columns are exactly the schema-level half of Gate 3.0,
   already done, and a real Gate 3.0 spec would mostly need to add the application layer
   (routes, UI, notifications) on top of them; or
2. Gate 1.3's states are a narrower, Gate-1.3-scoped concern (recording that a jurisdiction issued
   one of these three outcomes) that only resembles Gate 3.0's likely subject matter by name, and a
   real Gate 3.0 could turn out to need a different or additional data model entirely (e.g.
   versioned resubmission packages, a correction-request-to-document linkage, jurisdiction-side
   deadline tracking) that the master prompt gives no basis to rule in or out.

**Finding D.1 — Gate 1.3 schema groundwork for corrections/resubmissions exists and is unconsumed;
whether it is Gate 3.0's foundation or a separate, narrower concern is undetermined and this
document does not resolve it.** Owning sub-phase: none — this is a question for the user to answer
before any Gate 3.0 sub-phase is scoped, not a task assignable to one.

---

## §E. Whether the foundation is ready for Gate 3.0 to be scoped at all

`PHASE_0_FINDINGS.md` §E concluded, for Gate 2.0, that Phase 1 fell short in specific, named ways
without concluding the whole foundation was unusable — a graded finding, not a stop sign. The
scoping prompt asks this document to do the equivalent work for Gate 3.0, including saying so
plainly if the premise doesn't hold. It doesn't, but not for a reason internal to the codebase's
quality — every gate audited so far (1.0–1.7, 2.0) passed its own read-only review before being
speced or built. The reason is structural to what "Gate 3.0" currently *is*:

**A gate cannot be spec'd from a document that supplies no spec content and does not exist in this
repository.** §A and §B above establish that fully: there is no table row, no rationale paragraph,
no field list, no state list beyond what Gate 1.3 built for its own purposes, and no owner-assignable
sub-phase structure. This is not a code-quality finding — nothing in the codebase is broken or
under-tested relative to a Gate 3.0 spec, because no such spec exists to test against. It is a
readiness finding of a different kind: **the precondition for scoping Gate 3.0 — a spec, whether
"the original brief" supplied from outside this repo or a `GATE_3_0_SPEC.md` written the way
`GATE_2_0_SPEC.md` was — does not exist yet, and this document cannot manufacture one without
violating the master prompt's own rule against inventing content and presenting it as if it came
from a source that doesn't exist (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:24`, and the
`PHASE_0_FINDINGS.md:1521-1523` §S.1 precedent this document has followed throughout).**

Separately, and additively: §C above establishes that even if a spec existed today, three concrete
dependencies (client-portal reachability, §7's still-open items, credential isolation's unpulled
trigger — C.1–C.4) would need an explicit ruling on whether Gate 3.0 touches them, before any
sub-phase could be sequenced the way `GATE_2_0_SPEC.md` §6 sequenced 2.1–2.5. None of these is a
"foundation is broken" finding either — they are open questions inherited from Gate 2.0's own §7,
correctly still open per that document's own status tags, that a Gate 3.0 spec would need to answer
rather than silently assume.

**Conclusion: the foundation is not ready for Gate 3.0 to be scoped, but "not ready" here means
"the input needed to scope it does not exist," not "the codebase needs remediation before Gate 3.0
can be built."** This is a narrower and more specific claim than §E's Gate-2.0-era finding, and it
points at a different next action: not more read-only investigation of this repo (this document and
§C's re-verification already cover what's here), but either (a) the user supplying "the original
brief" content from outside this repository, or (b) the user directing that Gate 3.0 be re-scoped
from scratch, in-repo, the same way Gate 2.0 was — starting from §0.2's one workflow arrow and
Gate 1.3's existing groundwork (§D) rather than from a document that isn't coming.

---

## §F. Sub-phase breakdown, blast radius per migration

**Not produced, and this section states why rather than fabricating one to satisfy the requested
format.** Every prior gate's sub-phase table (`GATE_2_0_SPEC.md` §6, and the master prompt's own
§3.1–§3.8 for Gates 1.0–1.7) breaks an existing design into ordered, independently-testable slices
— the sub-phase boundaries come from the design itself (which tables depend on which, which grants
must precede which code). Gate 3.0 has no design to break apart (§A, §E). Writing a sub-phase table
here would mean inventing both the scope of each sub-phase and their sequencing from nothing citable
— exactly the "producing a plan that assumes the premise holds" outcome the scoping prompt's own
final paragraph asked this document not to produce if the premise doesn't hold.

What can be stated instead, concretely: **the first sub-phase of any real Gate 3.0, whenever one is
scoped, is not implementation — it is resolving §D's undetermined question** (is Gate 1.3's
groundwork Gate 3.0's foundation, or a separate concern) **and §C.5's scoping decision** (does Gate
3.0 touch the client portal at all). Both are prerequisites to writing a `GATE_3_0_SPEC.md` in the
first place, let alone sequencing sub-phases within it.

---

## §G. §N discipline applied from the start

Per the scoping prompt's instruction to apply `GATE_2_0_FINDINGS.md` §N's rules "from the start"
rather than retrofitting them later:

**Rule 1 — every action-naming finding in this document carries an owning sub-phase at write
time.** Applied throughout: B.1, C.5, D.1 each state "Owning sub-phase: none" explicitly, rather
than leaving the field blank or implying one exists. This is a deliberate departure from
`GATE_2_0_FINDINGS.md`'s own §H–§M convention, where "Owning sub-phase: 2.x" was the normal case and
"none" would have been the exception worth flagging — here it is the reverse, because no sub-phase
structure exists yet for anything to own. Recording "none" explicitly, rather than omitting the tag
because it feels vacuous, is what prevents a future document from finding these three items
unowned and unable to tell whether that's an oversight (the §N orphan pattern) or the documented,
intentional state it actually is.

**Rule 2 — this document states plainly, for whoever writes the first real pre-branch check
inheriting these findings: audit all of B.1, C.1–C.5, D.1, and this section's own conclusion (§E),
not only whichever one touches your sub-phase's own migration.** In particular: any future
`GATE_3_0_SPEC.md`, however it comes to be written, inherits B.1 and D.1 as open scoping questions
that must be answered in that document's own text before its sub-phase table is trustworthy — the
same way `GATE_2_0_FINDINGS.md` M.4(b) demonstrated what happens when a later check re-asserts a
claim an earlier section already found false instead of checking the earlier section first.

---

## §H. What happens next

This document does not produce a case where `APPROVED: PHASE 3.0` would be the next honest step —
per §E, there is nothing yet approved-able as "Phase 3.0," because no spec exists for the token to
approve into motion. The scoping prompt anticipated this outcome as a live possibility ("if Gate
3.0's premise doesn't hold against the current codebase, say so plainly rather than producing a plan
that assumes it does") and named the alternative path explicitly: this is that outcome.

Two concrete paths forward, neither chosen here:

1. **Supply "the original brief"'s actual content** for corrections/resubmissions from outside this
   repository, at which point a `GATE_3_0_SPEC.md` can be written against real spec content the same
   way `GATE_2_0_SPEC.md` was written once Gate 2.0's own scoping was worked out — informed by §D's
   findings about what Gate 1.3 already built, so the new spec doesn't duplicate or silently
   contradict it.
2. **Direct that Gate 3.0 be re-scoped in-repo from scratch**, the same way Gate 2.0 itself moved
   from a one-line table entry to a fully speced gate — starting from §0.2's single workflow arrow
   ("Municipal Review → Corrections & Resubmission → Permit Issuance") and Gate 1.3's existing
   `revision_requested`/`resubmitted`/`appeal_filed` groundwork (§D) as the two concrete, citable
   starting points, with §D's undetermined question (foundation vs. separate concern) as the first
   thing that scoping work would need to settle.

Either path starts with a decision this document surfaces but does not make: whether Gate 1.3's
existing states are Gate 3.0's foundation. §D.1 restates this as the standing open question.

Not self-issuing `APPROVED: PHASE 3.0`. This document is for review.
