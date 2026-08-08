# Permit status transitions

Lifecycle & Compliance Expansion, Phase 1.3 (flag `PERMITFIELD_FF_APPLICATIONS`,
`lib/flags.ts`'s `isApplicationsEnabled()`). This document, `supabase/migrations/`
`20260806000022_permit_status_machine.sql`'s `permit_status_transitions` table,
and `lib/permit-status/transitions.ts`'s `PERMIT_STATUS_TRANSITIONS` map are
**three views of one single source of truth** — the SQL table is what
`transition_permit_status()` actually enforces at write time; the TS map is a
pure, unit-tested mirror for anything that needs the same answer without a
round-trip (e.g. a future UI greying out an illegal next-state button); this
file explains *why* the edges are shaped the way they are. All three must
agree — see `lib/permit-status/transitions.test.ts`'s own header comment for
the cross-check discipline (same pattern `lib/jurisdictions/staleness.ts`
established in Phase 1.2 for `jurisdiction_source_effective_status()`).

## Why this is a second, separate column from `status`

`permit_applications.status` (`application_status`) already exists
(`20260806000006`) and is not touched by this gate at all. It is a 13-value
enum describing the AI document-processing **pipeline's** own progress
(`draft` → `uploading` → `extracting` → … → `submitted`), written exclusively
by `lib/inngest/functions/{extract,audit,generate-pdf}.ts` and
`app/api/applications/[id]/{confirm-review,submit}/route.ts`. `permit_status`
(`permit_status_enum`, this gate) is a different concept: the permit's real
progress through the org's own workflow and the issuing jurisdiction — a fact
that exists whether or not this system ever ran an AI extraction on the
application at all. See `PHASE_0_FINDINGS.md` §L for the full citation-backed
investigation into why these had to stay separate rather than being merged
(rule 8 stop-and-ask, resolved with the user before any migration SQL was
written) and §L.3(b) for the one place they are DB-enforced to agree
(`submitted`, below).

## The 16 statuses and their three role tiers

| Tier | Statuses | Who can move an application *into* this tier |
|---|---|---|
| `org` | `intake`, `requirements_review`, `collecting_documents`, `internal_review`, `ready_to_submit`, `withdrawn` | The full existing `permit_applications`-write role set: `owner`, `org_owner`, `platform_admin`, `member`, `permit_manager`, `permit_coordinator`, `applicant_contractor`. These describe the org's own work — self-attestation is correct here, same as today's plain `permit_applications` UPDATE. |
| `submission` | `submitted`, `under_municipal_review` | `permit_manager` and above only (`owner`, `org_owner`, `platform_admin`, `permit_manager`). This is the handoff point to the jurisdiction — someone accountable should own it. |
| `jurisdiction_outcome` | `approved`, `rejected`, `issued`, `expired`, `closed`, `revision_requested`, `resubmitted`, `appeal_filed` | `permit_coordinator` and above only (`owner`, `org_owner`, `platform_admin`, `permit_manager`, `permit_coordinator`). These record an **external decision being made about the org**, not an org action being taken. Letting `applicant_contractor` set `issued` would make the column an unauditable self-attestation, defeating the entire point of a permit status machine. |

Enforced *inside* `transition_permit_status()`, not via a new RLS policy on
`permit_applications` — explicit design decision: the RPC is the only
sanctioned write path for `permit_status`, so the authorization rule belongs
there, where the rejection message can name both the caller's actual role and
the tier they were missing. This does not change `permit_applications`' own
RLS in any way (unchanged since `20260806000006`).

**A note on the three correction/resubmission states** (`revision_requested`,
`resubmitted`, `appeal_filed`): the master prompt's spec calls for 16 total
statuses and describes the `jurisdiction_outcome` tier as "approved, rejected,
issued, expired, closed, plus any correction/resubmission states in the 16,"
leaving the exact 3 remaining names to this gate's judgment. They are modeled
here as: `revision_requested` (the jurisdiction asks for changes before it
will proceed), `resubmitted` (the org's response, handed back to the
jurisdiction), and `appeal_filed` (the org contests a `rejected` decision).
All three sit in the `jurisdiction_outcome` tier, not `org`, because each one
represents either a jurisdiction's own action or a handoff back to the
jurisdiction — the same accountability reasoning that puts `submitted`/
`under_municipal_review` in the `submission` tier rather than `org`.

## The legal transition graph

```
intake ────────────► requirements_review ────────────► collecting_documents
  │                          │                                  │
  ▼                          ▼                                  ▼
withdrawn ◄────────── withdrawn                            internal_review ──► withdrawn
                                                                  │  ▲
                                                                  ▼  │ (kicked back for more docs)
                                                          ready_to_submit ──► collecting_documents
                                                                  │  │
                                                                  │  ▼
                                                                  │ withdrawn
                                                                  ▼
                                                              submitted
                                                                  │
                                                                  ▼
                                                     under_municipal_review
                                                        │      │      │
                                        ┌───────────────┘      │      └────────────┐
                                        ▼                      ▼                   ▼
                              revision_requested            approved            issued
                               │     │      │                 │  │                │  │
                     (fix docs)│     │      ▼                 │  └──► expired     │  └──► closed
                                ▼    │  resubmitted            ▼                   ▼
                    collecting_docs │      │                issued            expired
                                     │      ▼                                     │
                                withdrawn  under_municipal_review                 ▼
                                                                                closed
                                                                  under_municipal_review ◄─┐
                                                                        rejected            │
                                                                          │  │              │
                                                                          │  └──► closed    │
                                                                          ▼                  │
                                                                     appeal_filed ───────────┘
                                                                          │  │
                                                                          │  └──► rejected
                                                                          └────► closed
```

The exhaustive, authoritative edge list (also `permit_status_transitions`'
seed rows and `PERMIT_STATUS_TRANSITIONS`' keys):

| From | Legal next states |
|---|---|
| *(new application)* | `intake` |
| `intake` | `requirements_review`, `withdrawn` |
| `requirements_review` | `collecting_documents`, `withdrawn` |
| `collecting_documents` | `internal_review`, `withdrawn` |
| `internal_review` | `ready_to_submit`, `collecting_documents`, `withdrawn` |
| `ready_to_submit` | `submitted`, `collecting_documents`, `withdrawn` |
| `submitted` | `under_municipal_review` |
| `under_municipal_review` | `revision_requested`, `approved`, `rejected`, `issued` |
| `revision_requested` | `collecting_documents`, `resubmitted`, `withdrawn` |
| `resubmitted` | `under_municipal_review` |
| `approved` | `issued`, `expired` |
| `rejected` | `appeal_filed`, `closed` |
| `appeal_filed` | `under_municipal_review`, `approved`, `rejected`, `closed` |
| `issued` | `expired`, `closed` |
| `expired` | `closed` |
| `closed` | *(terminal — no outgoing transitions)* |
| `withdrawn` | *(terminal — no outgoing transitions)* |

Notes on specific edges:

- `under_municipal_review → issued` exists alongside `under_municipal_review →
  approved → issued` because not every jurisdiction has a separate approval
  step before issuance — some issue directly. Both paths are legal; which one
  a given application actually takes is a jurisdiction-specific fact this
  gate does not model (no per-jurisdiction transition override exists yet).
- `internal_review`/`ready_to_submit`/`revision_requested` can all step back
  to `collecting_documents` — the org realizing it needs more documents is a
  normal, non-exceptional path, not modeled as an error state.
- `withdrawn` is reachable from every `org`-tier state up through
  `ready_to_submit` (the org can always change its mind before it hands the
  application to the jurisdiction) and from `revision_requested` (giving up
  after being asked for corrections), but **not** from anything past
  `submitted` — once a jurisdiction has the application, "withdrawing" it is
  a jurisdiction-side action this gate does not attempt to model; use
  `rejected`/`closed` for that outcome instead.

## The cross-machine gate: `permit_status = 'submitted'`

`transition_permit_status()` refuses to advance `permit_status` to
`'submitted'` unless `permit_applications.status` (the unrelated,
pre-existing pipeline column) is *already* `'submitted'`:

```sql
if p_to_status = 'submitted' and v_app.status <> 'submitted' then
  raise exception 'pipeline_not_submitted: ...';
end if;
```

This is the **only** place the two machines are coupled. There is no
auto-advance in either direction — flipping the pipeline's `status` to
`submitted` does not move `permit_status` for you, and vice versa — because
auto-advancing either would mean modifying already-shipped Phase-0-era
route/Inngest code as an unscoped side effect of this gate. See
`PHASE_0_FINDINGS.md` §L.3 for the full reasoning.

## Idempotency

`transition_permit_status(p_application_id, p_to_status, p_reason,
p_request_key)` accepts an optional `p_request_key uuid`. If a caller retries
the same logical transition with the same key (e.g. after a network timeout
where the first attempt may or may not have committed), the second call is a
silent no-op: it returns the application unchanged rather than re-validating
or re-raising. This is enforced by a **partial unique index** on
`application_status_history (org_id, application_id, request_key) WHERE
request_key IS NOT NULL`, not a separate idempotency-keys table — a separate
table would mean a two-phase write where the key and the transition record
could diverge on partial failure; putting the key inline on the same row that
records the transition means they can never disagree.

## Evidence columns (added, not yet enforced)

`permit_applications` gains `permit_number`, `decision_date`, and
`decision_document_id` in this gate — all nullable, all unenforced. They
exist so a future gate can add a `CHECK` constraint requiring evidence
(permit number, decision date, a document reference) before
`jurisdiction_outcome`-tier states like `approved`/`issued` can be recorded,
**additively**, without needing a new migration just to add the columns at
that point. Nothing in this gate requires them to be populated, and no route
or RPC in this gate writes to them.

## What is NOT done in this gate

- No UI reads or writes `permit_status` anywhere in `app/`. Same
  "infrastructure ships ahead of its first consumer" pattern as `audit_logs`
  (Phase 1.0) and `jurisdiction_sources` (Phase 1.2).
- `permit_status_tier()`/role-gating is enforced only inside
  `transition_permit_status()`. A direct `UPDATE permit_applications SET
  permit_status = ...` is still possible for anyone `permit_applications`'
  existing RLS already allows to update the row at all (`is_org_member`) —
  this gate does not add a trigger or RLS policy restricting `permit_status`
  specifically. Enforcement is opt-in by calling the RPC, the same
  "aspirational until wired everywhere" caveat every `lib/authz`-adjacent
  resource in this repo already carries.
- The evidence columns above are unenforced (see previous section).
- No per-jurisdiction override of the transition graph (e.g. "this
  jurisdiction never uses `approved`, only `issued`") exists — the graph
  above is a single, global legal-move set for every application regardless
  of jurisdiction.
