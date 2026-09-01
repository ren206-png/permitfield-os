# Gate 2.0 Findings — Client Portal Scoping (Read-Only)

**Status:** investigation complete, zero implementation. This document is the deliverable in
full — no migration, component, Server Action, RLS policy, or `client_visible` column (including
as a comment) was added to the repository to produce it. Every claim below is either a direct
citation to a file already in this repo, or explicitly marked as this document's own recommendation
(never silently blended with a cited fact).

**Why this document exists instead of Gate 2.0 code:** unlike Gates 1.0–1.7, the master prompt
(`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md` §3) contains **no implementation spec** for
Gate 2.0 — only the one-line table entry and rationale paragraph reproduced in §A below. §0.1.1's
phase-gate rule ("You may not begin a phase until I reply with the exact token `APPROVED: PHASE
<n>` on its own line") was not satisfied by an informal "start Gate 2.0," and there is nothing to
build against even if it had been. This document is the read-only reconnaissance that has to exist
*before* a spec can be written, mirroring the rigor of `PHASE_0_FINDINGS.md` (cited throughout
below by its own §-letter convention). It resolves nothing. The auth-model question in §B is laid
out as options with tradeoffs specifically so it is not resolved by whichever is easiest to bolt
onto the existing `can()`/membership machinery.

Nothing in this document is authorized for implementation. Implementation requires the literal
`APPROVED: PHASE 2.0` token after this document is reviewed — see §G.

---

## §A. Why Gate 2.0 has no spec to build against

The master prompt's full statement on Gate 2.0 (`docs/PERMITFIELD_OS_EXPANSION_MASTER_PROMPT.md:117-120`):

- Table row: `2.0 | Client portal — moved out of Phase 1 | permitfield_client_portal`
- Rationale (paraphrased, source cited): the client portal is the single largest external attack
  surface in the product — untrusted users, file upload, cross-tenant read risk, and internal-note
  leakage. It must sit on top of a tenancy layer *already proven by tests*, not one being built
  concurrently. It must not be scaffolded during Phase 1. `client_visible` booleans must not be
  added "for later" — the flag itself is a security control, designed in 2.0 together with its
  enforcement, not ahead of it.

`PHASE_0_FINDINGS.md` has **no independent Gate 2.0 section**. The only reference is `§M.3` (a
Gate 1.4 addendum explaining why `application_documents` grants no access to non-org-members),
which cites this same master-prompt paragraph as the reason the client portal wasn't scaffolded
even partially in that gate. There is no `§`-lettered analysis of the client portal itself, no
discussion of `client_visible` as a concrete column, and (grep-confirmed) zero occurrences of
`client_visible` anywhere in the repository outside the master prompt's own sentence above.

This document is that missing analysis — but explicitly a *findings* document, not a §3-equivalent
spec. Writing an actual Gate 2.0 spec is downstream of the decisions in §B/§C/§D below, most of
which are the user's to make, not this document's.

---

## §B. The auth model is the fork in the road

This is the central open decision. It constrains session isolation, RLS policy shape, and
audit-log attribution (§D) downstream — so it is laid out here as three options with tradeoffs,
not resolved by ease of implementation.

**Current auth-relevant facts** (`supabase/config.toml`, local dev config — the only auth
configuration in the repo):
- `enable_signup = true`, `minimum_password_length = 6`, `enable_confirmations = false` — plain
  email/password signup, no email verification required, is already live for `auth.users` today.
- `enable_anonymous_sign_ins = false`. No external OAuth provider enabled. No passkey/WebAuthn.
  No third-party auth (Clerk/Auth0/Firebase/Cognito) configured.
- Standard Supabase email OTP infrastructure exists and is enabled (`otp_length = 6`,
  `otp_expiry = 3600`) — this is the substrate a magic-link flow (Option 3 below) would reuse; it
  is not currently wired to any distinct "client" signup path, only the default auth flow.
- `jwt_expiry = 3600` (1 hour), refresh token rotation on.

**Current schema fact that makes this urgent, not hypothetical:** `org_role` already has a
`client_user` value (migration `20260806000018`, Phase 1.0), and `is_org_member()` — the RLS
primitive gating nearly every table in the schema — does not branch on role at all; it only checks
row existence in `org_members`. **If a `client_user` role were assigned to a real user today, that
user would have full internal-staff-level read/write access to essentially the entire schema**,
through the org's existing membership boundary, with no client-specific restriction enforced
anywhere at the database layer. This is developed fully in §E; it is stated here because it means
Option 1 below is not "add a new thing" — it is "the schema already half-implements this option,
insecurely, today."

One correlation worth naming before the options themselves, not buried in §D: Option 1 is the only
one of the three that costs nothing on audit-log attribution (§D develops this in full), and Option
1 is also the option §E identifies as already half-implemented, insecurely, in the shipped schema.
Those two facts are not independent — Option 1 is cheap on attribution *because* it reuses
`org_role`/`org_members` machinery exactly as-is, and that same machinery is exactly what §E.2 shows
already grants `client_user` full member-level access with nothing today distinguishing it from
`owner` or `document_reviewer` at the RLS layer. The low cost is not a point in Option 1's favor
independent of §E — it is a restatement of it. A schema that already assumes clients are members is
naturally cheap to extend along the "clients are members" axis; that is the thing §E says is unsafe,
not a coincidental discount.

### Option 1 — Shared Supabase project, client as `org_member` with `client_user` role

The client authenticates into the same Supabase project as internal staff, gets an `org_members`
row with `role = 'client_user'`, and is distinguished from staff purely by role.

- **Session isolation:** none beyond role. A client session and a staff session are
  indistinguishable to Postgres except via `org_members.role` — there is no bulkhead. Any RLS bug,
  missing role check, or future policy that forgets to exclude `client_user` affects staff-only
  data immediately, with no second boundary to fall back on.
- **RLS policy shape:** every existing policy in the schema (grep-confirmed: `is_org_member()` /
  `is_org_owner()` are the only two primitives used almost everywhere) would need to be revisited.
  Since `is_org_member()` already returns true for `client_user`, this is not additive work — it
  is retrofit work across the entire policy surface, or a parallel projection layer (§C) sitting in
  front of it so the base tables' RLS never has to become role-aware at all.
- **Audit-log attribution:** zero schema change needed. `audit_logs.actor_role` is already
  `org_role`, which already includes `client_user`; `actor_user_id` already references
  `auth.users(id)`, the same table the client's own row would live in. Lowest-friction option by
  far on this axis (see §D).
- **Tradeoff:** this is *not* the cheap option once §E.2 is accounted for, and should not read as
  one. "Reuses 100% of existing tenancy infrastructure" sounds like a discount; it is actually the
  cost. Per §E.2, `client_user` is a legal role today that `is_org_member()` already treats as a
  full member — so choosing Option 1 does not mean designing a new access model and layering it on
  top of working RLS. It means the mandatory RLS audit/rewrite named two bullets up (or an
  equivalent projection layer, §C) is not optional hardening, it is this option's entry price,
  required before a single client account can safely exist. Options 2 and 3 pay their cost in new
  infrastructure built *alongside* the existing schema, which is untouched either way (§B Option 2's
  "the main project's existing RLS is untouched," Option 3's "this option likely does not use
  Postgres RLS/JWT auth for the client path at all"). Option 1 pays its cost by touching every
  shipped policy the schema currently has. That is a different *kind* of cost — schema-wide
  modification risk to an already-shipped, already-tested surface, versus net-new build — not a
  smaller number on the same scale, and the four-bullets-per-option format above should not be read
  as presenting these as comparable in kind.

### Option 2 — Separate Supabase project for the client-facing surface

Clients authenticate into a second, dedicated Supabase project with its own `auth.users`, JWT
signing keys, and (likely much smaller) schema. Internal staff never touch this project directly;
a backend layer (running with elevated privilege against the *main* project) is the only bridge.

- **Session isolation:** complete at the JWT level — a client-project JWT is cryptographically
  invalid against the main project's Auth, and vice versa. There is no shared session object for a
  bug to confuse.
- **RLS policy shape:** the main project's existing RLS is untouched. `client_visible` enforcement
  moves entirely into the bridge layer (§C) — a small, explicit set of read paths the client-facing
  backend is allowed to call, rather than a client ever holding a Postgres session against the main
  database at all.
- **Audit-log attribution:** the concrete new problem this option introduces — `audit_logs.actor_user_id`
  is `NOT NULL references auth.users(id)` in the **main** project; a client user's id lives in the
  **second** project's `auth.users` and cannot satisfy that FK. This is a real, named schema
  dependency (see §D), not a detail to discover mid-implementation.
- **Tradeoff:** strongest security boundary — a client-side RLS mistake literally cannot expose an
  internal-staff table, because the client never has a connection where that table's RLS is
  evaluated. Cost: two Supabase projects to operate, an explicit sync/bridge layer to design and
  audit in its own right, and doubled auth configuration surface.

### Option 3 — Tokenless, scoped magic-link surface (no persistent client account)

A client receives a signed, expiring, single-application-scoped link (or a link plus a short OTP
step) with no account, no password, and no persistent session beyond that link's lifetime.

- **Session isolation:** strongest in one sense — there is no account to compromise and no
  cross-application session to leak, because there is no session; each link authorizes exactly one
  scope. Weakest in another sense — possession of the link (or the link plus OTP) *is* the entire
  credential, with no separate re-authentication factor unless deliberately added.
- **RLS policy shape:** this option likely does not use Postgres RLS/JWT auth for the client path
  at all. A server-side Route Handler validates the token, then reads on the client's behalf via a
  narrowly-scoped function (or `service_role`) — the client never gets a Postgres session. This
  means the enforcement point is a hand-written server-side check, not RLS — which is close to the
  "boolean checked in application code" pattern §C explicitly rejects, *unless* that check is
  centralized in exactly one server-only data-access function that is the sole permitted path to
  client-visible data (functionally a projection layer implemented in TypeScript instead of SQL,
  not a scattered per-route boolean). That "unless" is doing real work and is worth stating plainly
  rather than leaving as a parenthetical qualifier: the single-function invariant is a convention,
  not a mechanism — nothing in Option 3 stops a second call site from being written against
  `service_role` (or the underlying table directly) by someone who doesn't know the invariant
  exists, six months or six engineers from now. Options 1 and 2 both ultimately push enforcement
  into SQL — RLS the database evaluates on every query regardless of caller intent, or the FK/JWT
  boundary of a second project the database itself refuses to cross. Option 3's enforcement point,
  as specified, holds only for as long as every future caller remembers and respects it. That is
  the same asymmetry named in Option 1's tradeoff above, applied to a different axis: a
  discipline-dependent enforcement point is weaker in kind than a mechanically-enforced one, not
  just weaker in degree. If Option 3 is chosen, this single-function invariant needs its own
  enforcement (a lint rule, a restricted DB role/connection string only that function holds, or
  equivalent) — "unless" is not yet a control, it is a description of what a control would look
  like.
- **Audit-log attribution:** no persistent `actor_user_id` exists to attribute to. `audit_logs.actor_user_id`
  is `NOT NULL`; representing this actor class would require either a synthetic per-link actor
  identity, or relaxing that constraint and adding a separate non-FK identifier column. `actor_role`
  would also need a value that fits a non-account actor — `client_user` implies persistent identity
  this option deliberately doesn't have.
- **Tradeoff:** smallest surface for account-takeover-class risk (no client password, no
  long-lived client session), and matches how many permit portals already hand off one-off document
  requests. Cost: no persistent "client dashboard across multiple projects" experience without
  layering a real account system back on top (a product decision, not a technical one), and link
  distribution/expiry/revocation becomes its own security surface to design carefully.

**This is not resolved here.** Whichever option is chosen determines the cost structure of §C and
§D below, not just their implementation detail.

---

## §C. Where `client_visible` enforcement must live

No `client_visible` column, flag, or precedent exists anywhere in this repository today
(grep-confirmed, zero hits outside the master prompt's own sentence quoted in §A). This section
specifies the enforcement *point*, not the field — per instruction, naming where enforcement lives
before the field exists, and explicitly rejecting "a boolean checked in application code," which is
the version that leaks the first time someone writes a new query and forgets it.

Three candidate enforcement points, with a recommendation:

1. **Row-level** (an RLS policy on the base table referencing a `client_visible`-style predicate,
   scoped to the requesting client's own linked rows). Correct fit only for tables where visibility
   is a genuinely all-or-nothing property of the *row* — e.g., whether a specific
   `application_documents` row has been released to the client at all. Wrong fit as a general
   mechanism: RLS on a base table is not safe by omission — a new column added to that table by a
   future migration is visible to any row that already passes the row filter, with no additional
   gate.

2. **Column-level** (`REVOKE`/`GRANT` on specific columns, exactly the pattern this schema already
   uses for `permit_applications.status` — migration `20260806000022` — and inherits "for free" on
   `readiness_override_*`, migration `20260806000025`). Correct fit for tables where a client
   should see the row but never specific columns on it — the concrete case already identified in
   this schema is `clients.notes`, called out in `lib/authz/index.ts`'s own `client_user` comment
   as internal CRM data, but currently fully readable by anything RLS treats as an org member
   (§E.2). Column grants are precise but do not compose well across many tables — a `REVOKE`/`GRANT`
   pair is per-table, per-column, hand-maintained work.

3. **View/projection layer** — a set of views, or (if Option 2/3 from §B is chosen) backend
   endpoints, that `SELECT` an explicit allow-list of columns from explicit, client-scoped rows,
   never `SELECT *` and never the base table directly from a client session. This is the only one
   of the three that is **safe by default**: a column added to a base table in some future,
   unrelated migration does not automatically become client-visible — it has to be explicitly added
   to the projection before a client can ever see it. Every other mechanism above defaults to
   "visible unless specifically restricted"; this one defaults to "invisible unless specifically
   exposed."

**Recommendation:** the view/projection layer is the primary enforcement point, precisely because
it is safe-by-default in a schema whose only other precedent for this kind of restriction
(`is_org_member()`) has already shown the failure mode this needs to avoid — see §E.2. Column-level
`REVOKE`/`GRANT` should layer on top of it as defense-in-depth for specifically-identified
never-client-visible columns (`clients.notes` today; likely others once this is scoped in full),
the same layered pattern this schema already applies to `permit_status` (RLS *and* column grants
together, not either alone). Row-level `client_visible` flags should be reserved for the narrower
case of a genuinely conditional row (a document not yet released), not used as the general
mechanism — using it generally would recreate the "safe unless a future migration forgets"
problem this section exists to avoid.

**This recommendation is not uniform in strength across §B's options, and should not be read as
such.** The projection layer is the primary enforcement point regardless of which option §B
resolves to, but what it is *made of*, and what enforces it, differs by option:

- **Under §B Option 1**, the projection layer is SQL — views (or `SECURITY DEFINER` functions)
  the database itself evaluates on every query, the same way it evaluates RLS today. The invariant
  "clients only see the allow-listed columns/rows" is mechanically enforced regardless of which
  application code calls it.
- **Under §B Option 2 or 3**, the projection layer is TypeScript — a bridge layer or Route Handler
  function that is supposed to be the sole permitted path to client-visible data. Nothing in
  Postgres enforces that it is the *only* path; a future call site that queries the base table (or
  `service_role`) directly bypasses the projection entirely, and the database will not refuse it.
  This is the same discipline-vs-mechanism asymmetry named on §B Option 3's own bullet: a
  convention that the single function is authoritative, not a control that guarantees it.

§C's recommendation — projection layer as primary, safe-by-default — holds under every option.
Its enforcement *strength* does not: mechanical under Option 1, discipline-dependent under Option 2
or 3 unless paired with its own enforcement (a lint rule restricting direct table/`service_role`
access outside the designated module, a restricted DB role or connection string scoped only to the
projection layer, or equivalent — the same gap named on §B's Option 3 bullet, not a new one). A
spec written against this section should not inherit a false sense of parity between "the
recommended pattern is a view" and "the recommended pattern is a function that behaves like a view
only if nobody writes around it."

---

## §D. Audit-log attribution for external actors

Current schema (`20260806000018_lifecycle_rbac_roles_and_audit_log.sql`): `audit_logs.actor_user_id`
is `NOT NULL references auth.users(id)`; `actor_role` is `NOT NULL org_role`. Write policy requires
`is_org_member(org_id) AND actor_user_id = auth.uid()`. Read policy (`can_read_audit_logs()`)
restricts reads to `owner`/`org_owner`/`platform_admin`/`auditor_readonly` — a `client_user`, under
any option in §B, would never be able to read the audit trail itself, only ever be its subject.
**Zero writers exist in the codebase today** — `lib/audit/log.ts`'s `writeAuditLog()` has no call
sites; the only real writes are inline `INSERT`s inside `override_readiness_check()` and
`review_project_permit_requirement()`.

This schema was designed around persistent, internal, `auth.users`-backed actors — reasonably, since
Phase 1 had no external-actor concept to design for. Whether it can represent a client action, or
needs extension, depends entirely on §B's resolution:

- **Under Option 1** (shared project): zero schema change required. `actor_role` already accepts
  `client_user`; `actor_user_id` already points at the same `auth.users` table a client's row would
  live in. This is the only option where "a client uploads a document" can be logged with today's
  schema unmodified.
- **Under Option 2** (separate project): a real, concrete blocker — `actor_user_id`'s FK target
  lives in the main project; a client's identity lives in the second project and cannot satisfy
  that constraint. Resolving this needs either (a) a mirrored, minimal identity row in the main
  project's `auth.users` for every client user (partially undoing the isolation Option 2 buys), or
  (b) extending `audit_logs` with a separate, non-FK external-actor identifier alongside the
  existing internal-actor column, with `actor_user_id` becoming nullable and a CHECK ensuring
  exactly one of the two actor representations is populated per row.
- **Under Option 3** (tokenless): no persistent actor exists at all. `actor_user_id NOT NULL` would
  need to be relaxed regardless, and `actor_role`'s closed `org_role` enum has no value that fits a
  non-account actor — `client_user` presumes persistent identity this option doesn't have. A
  synthetic per-link or per-application pseudo-actor is the likely shape, but is unexplored here.

This is named explicitly as a **Phase 1 dependency being surfaced now**, per instruction — not a
flaw in Phase 1 (audit_logs was never asked to model external actors), but a cost that §B's
resolution determines, and one the master prompt's own §0.1 "stop and ask" discipline would
otherwise force to surface mid-implementation instead of during scoping.

---

## §E. Where Phase 1 falls short

The master prompt's own rationale for moving the client portal to Gate 2.0 assumes it will be
built "on top of a tenancy layer that is already proven by tests." This section audits that
premise directly, and is written so it could have concluded the foundation is ready — it does not.

### §E.1 — RLS is membership-only, not role-differentiated, almost everywhere

Confirmed across every migration read in this investigation
(`20260806000002`, `20260806000009`, `20260806000013`, `20260806000018`, `20260806000019`,
`20260806000021`, `20260806000022`, `20260806000024`, `20260806000025`, `20260806000026`,
`20260806000027`): the only two RLS primitives in use across the entire schema are
`is_org_member(org_id)` and `is_org_owner(org_id)`. `is_org_owner()` only recognizes the literal
string `'owner'`, not the newer `'org_owner'` value added alongside it in migration 18 — a role
meant to be equivalent doesn't get owner-tier treatment anywhere it matters
(`PHASE_0_FINDINGS.md §S.2`). Exactly two functions in the whole schema branch on a *specific*
elevated role by name: `can_read_audit_logs()` and `is_platform_admin()` — both narrow,
special-purpose, and neither is a general pattern the rest of the schema follows.

`lib/authz/index.ts` — the module that *does* model per-role, per-resource permissions in detail,
including a `client_user` row that correctly withholds most grants — carries its own header
comment stating it is not wired into any route yet, and has zero call sites anywhere in the app
(confirmed by reading the full file). It is an aspirational document, not an enforcement layer.

`PHASE_0_FINDINGS.md §E` states this plainly for the original schema ("most write operations only
require plain membership, not owner"), and `§S.2` confirms Gate 1.7 made a deliberate decision to
*keep* dashboard visibility uniform across all 8 roles rather than begin role-scoping it,
explicitly flagging that as a choice for "a later gate," not something already handled.

### §E.2 — `client_user` is a legal, storable role today with zero enforced restriction

This is the concrete, present-tense consequence of §E.1, not a hypothetical: `client_user` has
been a legal `org_role` value since migration `20260806000018` (Phase 1.0). Nothing in the
database prevents an org owner from assigning it to a real `org_members` row today. If that
happened, RLS would grant that user the same `is_org_member()`-level access as any staff member —
including:

- `clients.notes` — explicitly identified in `lib/authz/index.ts`'s own `client_user` comment as
  internal CRM data that should not be client-visible, but with no RLS distinction drawing that
  line at the database layer.
- `audit_findings` / `application_documents`, reached through `permit_applications` via
  join-based policies that check org membership only.
- Every other org-scoped table in the schema, with the sole exception of `audit_logs` reads
  (gated by `can_read_audit_logs()`, which correctly excludes `client_user`).

The entire restricted-access design the role's name implies exists **only** in `lib/authz`'s
TypeScript matrix, which — per §E.1 — enforces nothing. This is the single most important finding
for §B and §C: Option 1 in §B is not "build a new access model," it is "close a gap that already
exists in the shipped schema."

### §E.3 — Test coverage: rigorous where it exists, not exhaustively verified as a whole

`supabase/tests/dashboard_queries.test.sql` is the strongest test in the suite on exactly the
question that matters here. It does not just assert "cross-org query returns 0 rows" — it first
proves, under the fixture-loading role with RLS not yet engaged, that the bare `WHERE org_id =
p_org_id` clause *does* match real seeded data for the org being denied (Part 1, lines 176–197),
so the later 0-row result under RLS is demonstrably RLS blocking a real match, not an empty match
to begin with. Part 4 goes further, using a third org with zero membership in either tested org as
the cleanest possible adversary. This is the concrete shape of the "nearly vacuous" risk raised
before this investigation began: an isolation assertion of the form "caller X querying org Y's
data returns 0 rows" is trivially — and silently — satisfiable whenever org Y's fixture data is
empty, which would make the assertion pass while proving nothing. This test file's own authors
identified that risk and closed it with an explicit control check.

I did not verify that every other assertion in `supabase/tests/tenant_isolation.test.sql` and the
rest of the `supabase/tests/*.test.sql` suite applies the same control-check discipline —
`tenant_isolation.test.sql`'s cross-tenant checks do insert a real fixture row for the "other"
org first in most cases (an equivalent safeguard), but I have not exhaustively confirmed this
holds for every assertion in every file in the suite (e.g. `permit_requirements_engine.test.sql`
was referenced by other migrations' comments but not opened in this pass). **This is flagged as an
open verification gap, not a finding either way** — see §G.

Separately, and independent of test *quality*: this repository has no test framework beyond raw
SQL files requiring Docker/psql to execute, which are absent from this environment
(`PHASE_0_FINDINGS.md §A`, §C`). Tenant isolation here is "proven" only in the sense that CI
(`.github/workflows/ci.yml`) runs these files on every push — not something independently
reproducible from this environment.

### §E.4 — Audit trail is not a working observability layer

`lib/audit/log.ts`'s `writeAuditLog()` has zero call sites anywhere in the app (confirmed by
reading the full file and grepping for its name). The only real writes to `audit_logs` are two
inline `INSERT`s, one inside `override_readiness_check()`, one inside
`review_project_permit_requirement()` — both narrow, both tied to a single specific action, neither
a general audit path (also cited in §D). This is distinct from §E.1's finding, not a restatement of
it: §E.1 is an authorization gap (RLS doesn't differentiate roles); this is an observability gap
(nothing records whether it held up in practice). The two fail independently — closing §E.1 does
not create a working audit trail, and adding audit writes does not fix RLS. A `client_user` role
assigned today (§E.2) reading `clients.notes` or `application_documents` would do so with no
artifact anywhere that would let anyone detect it after the fact. An audit log with a schema, RLS
policy, and read-gate function but no writer is not a degraded audit trail — it is an absent one,
dressed as a present one to anyone who checks the schema without checking for call sites.

### §E.5 — Two smaller gaps worth naming

- `lib/auth/org-context.ts`'s `OrgContext.role` type is `'owner' | 'member'` — narrower than the
  full 8-value `Role` union `lib/authz` defines. Even under §B's Option 1, today's application-layer
  session object cannot correctly represent a `client_user` role without first being widened.
- `lib/entitlements/index.ts` has a single hardcoded tier and no real billing system
  (`PHASE_0_FINDINGS.md §H`). A client-facing surface is a plausible place a product would want
  plan/tier gating; that infrastructure does not exist yet.

### §E.6 — Conclusion

The tenancy layer is **not** ready to have a role-differentiated, client-facing access surface
bolted directly onto its existing RLS policies as they stand today — §E.1 and §E.2 show that gap
is not latent, it is already shipped and exploitable by a simple role assignment. It **is** ready
to serve as the backing store for a design that keeps client access behind a narrow, explicit
projection layer (§B Option 2 or 3, or Option 1 only if paired with the full RLS audit/rewrite §B
describes as its cost) — the tenancy boundary itself (`is_org_member`/`is_org_owner`, composite
FKs, append-only triggers) is consistently and correctly applied everywhere it was reviewed in
this pass, and the one genuine test-design risk found (§E.3) was already identified and mitigated
by its own author, not discovered here for the first time.

That "consistently and correctly applied everywhere it was reviewed" claim is, specifically, a
claim from static policy inspection — reading migration files and confirming what each policy
says. §E.4 is the reason that claim cannot be strengthened to a runtime one: there is no working
audit trail that would surface a contradiction if this conclusion were wrong, or if a correctly-
reviewed policy today were weakened by a future migration tomorrow. The conclusion stands on what
was read, not on any evidence of what actually happened at runtime — because nothing currently
records what happened at runtime.

---

## §F. Sub-phase breakdown, blast radius per migration

Sequencing below is written to work under any of §B's three options, with the option-dependent
cost called out per sub-phase rather than assumed. Numbering follows this repo's `Gate N.M`
convention.

| Sub-phase | Scope | Blast radius |
|---|---|---|
| **2.0** | Auth-model decision (§B) + a real §3-equivalent spec written against it, reviewed and approved before any code. Not a migration. | None — no schema touched. This document does not substitute for that spec; it is the input to it. |
| **2.1** | Client identity & linkage schema — a `client_users`-equivalent table (or, under §B Option 2, the second project's own schema) linking to the existing `clients` table. | Net-new table(s) only. Zero changes to any existing table, RLS policy, or grant. |
| **2.2** | Projection layer (§C) — views/functions (or backend endpoints, under Option 2/3) implementing the explicit allow-list read path. This is where `client_visible`-equivalent enforcement is actually built. | Net-new only, gated behind a default-off flag (`isClientPortalEnabled`, following this repo's existing `lib/flags.ts` convention). No existing RLS policy is modified *unless* §B Option 1 is chosen, in which case this sub-phase is where the existing-policy audit from §B's Option 1 tradeoff actually happens — call this out specifically per master-prompt §0.1 rule 8 before touching any shipped policy. |
| **2.3** | `audit_logs` extension for external-actor attribution (§D). | Additive at minimum (new nullable column(s) under Option 2/3); zero change under Option 1. |
| **2.4** | Document upload/download surface for clients, reusing `lib/storage/documents.ts`'s existing MIME/size constraints, routed exclusively through the §2.2 projection layer — never a direct storage-bucket RLS grant to a client session. | Net-new Route Handler(s) + possibly a narrow storage policy addition scoped only to client-uploaded paths; existing `is_org_member`-gated bucket policies (`20260806000013`) untouched. |
| **2.5** | Portal UI/routes, last — only once 2.1–2.4 have their own isolation tests written in the same style as `dashboard_queries.test.sql` (§E.3), with a `client_user`/external-actor fixture as the adversary, not just another org. | UI-only; no schema change. |

Any sub-phase that touches an existing RLS policy (only plausible under §B Option 1) should be
treated as its own stop-and-ask point regardless of where it falls in this table, per §0.1's own
rule 8 — this table sequences the *default* additive path, not a license to skip that rule if the
chosen option requires a rewrite.

---

## §G. Open questions / what happens next

Waiting on, in order:

1. A decision among §B's three options (or a fourth this document didn't enumerate) — explicitly
   not this document's decision to make.
2. Confirmation or correction of §E's conclusion, since it is the load-bearing claim the rest of
   this document depends on.
3. Resolution of the verification gap named in §E.3 (whether every assertion in
   `tenant_isolation.test.sql` and the rest of `supabase/tests/*.test.sql` applies the same
   control-check discipline `dashboard_queries.test.sql` does) — worth closing before or during
   §2.0's spec-writing, not assumed either way here.
4. The literal `APPROVED: PHASE 2.0` token, per §0.1.1, before any migration, component, or
   `client_visible` column is written.

No code, schema, migration, or component changes were made in the course of producing this
document.

---

## §H. Gate 2.0 pre-branch addendum — spec-vs-repo conflict check (added before the 2.1 branch,
per request, mirroring `PHASE_0_FINDINGS.md`'s `§L`/`§M`/`§O`/`§P`/`§Q`/`§S` pre-branch-addendum
convention for prior gates)

`APPROVED: PHASE 2.0` was issued against `GATE_2_0_SPEC.md`, scoped to sub-phase 2.1 only. This
section checks that spec's claims and its 2.1 migration against the actual, current state of this
repository — direct `git`/`grep`/file reads run in the course of writing this section, not recalled
from earlier in this thread — before any branch is created. No code, schema, migration, or
component change was made to produce this section either.

**H.1 — §0.1's corrections are confirmed accurate, not stale.** `20260806000029_org_members_role_not_client_user.sql`
is merged to `main` (commit `1b9e21b`, `git log` confirmed) and present in the working tree.
`lib/authz/index.ts` still carries its `client_user` row unchanged (line 402 and surrounding) — the
spec's claim that this row is now provably unreachable dead code, not that it's been removed, holds
exactly as stated.

**H.2 — §5's `application_documents` `service_role` INSERT gap is still real, unpatched, confirmed
live.** `20260806000011_grants.sql` grants `authenticated` `select, insert, delete`;
`20260806000015_service_role_grants.sql` grants `service_role` only `select, update` — no `insert`,
today, in the current migrations directory. The spec's sub-phase-2.3 grant is necessary and has not
been applied by anything already in the repo.

> **Closure — Owning sub-phase: 2.3. Status: Executed, `860d787`.**

**H.3 — No naming collisions.** Grepped the full repo for `token_status`, `client_access_tokens`,
`client_access_log`, `token_lifecycle_events`: zero hits outside `GATE_2_0_SPEC.md` itself. Clean to
implement exactly as named.

**H.4 — Real gap in the 2.1 migration as literally written: missing `pgcrypto` extension
statement.** §2's schema calls `gen_random_uuid()` five times (across `client_access_tokens`,
`token_lifecycle_events`, `client_access_log`, and the forward-path `client_accounts`) but never
issues `create extension if not exists pgcrypto;`. Project 1's own enablement of that extension
(`20260806000001_extensions.sql`) has zero effect on project 2 — separate Supabase project, separate
Postgres instance, nothing shared, exactly per §2's own "no shared FK space" framing applied one
level further. This repo's established convention is to not assume `pgcrypto` preinstalled — it
explicitly enables it rather than relying on a platform default. As literally written, the 2.1
migration fails on a fresh project the first time it hits `gen_random_uuid()`. Needs
`create extension if not exists pgcrypto;` added before first use.

> **Closure — Owning sub-phase: 2.1. Status: Executed, `135d5c8`.**

**H.5 — No second Supabase project exists yet, anywhere.** One `supabase/config.toml` in this repo,
no env-var scaffolding for a second project's URL/keys anywhere (`lib/`, `.env.example`, or
otherwise). This is the same gap §7 already named ("infra provisioning... not addressed"), but it is
not just an open question deferred to later — it is a hard precondition specifically for 2.1, since
2.1 *is* the second-project schema. The project has to exist and be reachable before its first
migration can run. Sequence this explicitly as 2.1's actual first step, not something assumed to have
happened before 2.1 "starts."

> **Closure — Owning sub-phase: 2.1. Status: Executed, `135d5c8`.**

**H.6 — Credential-isolation naming is not yet decided, and the existing convention doesn't leave
an obvious slot for it.** `lib/supabase/service-client.ts` is the sole existing module for project
1's `service_role` client, and its env vars are generically named
(`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) — nothing in the name scopes them to
"project 1" specifically, because until now there was only one project. §3's structural enforcement
mechanism (physical credential isolation) depends on project 2's `service_role` credential living
under its own, distinctly-named module and env vars that this file and these names never touch.
That naming should be decided now (e.g. `CLIENT_PORTAL_SUPABASE_URL` /
`CLIENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY`), not left for 2.4 to retrofit onto whatever the bridge
layer's author happens to call it, given the existing file already occupies the generic name.

> **Closure — Owning sub-phase: 2.1 ("decide now, at 2.1" — explicit deadline in this finding's own
> text). Status: Not executed at 2.1. Slipped silently past 2.1's actual commit; re-flagged
> independently by K.5 before 2.4 opened; executed late, at 2.4, `40fa7a2`. Delayed past its own named
> sub-phase, but self-caught by a later conflict check before implementation depended on it — distinct
> from J.3/K.3 below, which were never re-caught.**

**H.7 — Missing rollback SQL for migration 29, found while checking H.1.** `supabase/migrations_rollback/`
(untracked, verified present) holds one rollback file per migration for all 28 migrations that
predate `20260806000029`, but none for `20260806000029` itself — confirmed by direct directory
listing, not assumed. Not a Gate 2.0/2.1 blocker (2.1 touches project 2 only, no project-1 migration
at all), but flagged because it's a live, verifiable gap in an established repo convention, found in
the course of this check rather than asserted from an unverified source.

> **Closure — Owning sub-phase: none named at the time this finding was written (deferred as "a Gate
> 2.0 closeout deliverable" per `supabase/migrations_rollback/README.md`'s original text). Status:
> Executed 2026-09-01, after Gate AI-1 had also shipped migrations 30-38 on top of the single migration
> (29) this finding named — closed for the full 29-38 range in one pass rather than 29 alone, so the
> gap didn't reopen the moment AI-1.1's migrations landed. All 10 new rollback files verified via
> `scripts/test-migration-rollbacks.sh` walking 38 -> 1 against a live local Postgres (the same
> discipline the original 28 were verified with): every rollback applies cleanly in strict reverse
> order, the fully-rolled-back state is genuinely empty, and a subsequent `supabase db reset` succeeds.
> See `supabase/migrations_rollback/README.md`'s "How this was tested" section for the full account,
> including two call-outs specific to this range (30's data-dependent guard, and 34/35's must-roll-
> back-together ordering). Same day, running the full `npm run test:sql` suite (not previously run in
> this engagement) surfaced one further gap this closeout pass caught rather than missed: `service_role`
> had never been granted INSERT on `jurisdiction_code_chunks`, so its own dimensions test (added
> alongside migration 37, never actually executed until this run) failed on fixture setup. Migration 39
> grants it, with its own rollback file, extending this same closure to 29-39. All 17 SQL test files
> pass after.**

**H.8 — Working tree on `main` is not clean; two uncommitted, unrelated changes exist outside Gate
2.0's scope.** `app/(app)/contractors/new/new-contractor-form.tsx` and
`app/(app)/projects/new/new-project-form.tsx` both have uncommitted diffs changing
`grid-cols-N` to `grid-cols-1 gap-3 sm:grid-cols-N` — a real, single-breakpoint (`sm:`) responsive
layout change, confirmed by direct `git diff`. No test file anywhere in the repo references
"breakpoint" or "responsive" (grepped `*.test.*`/`*.spec.*`, zero hits) — this diff is real but
unverified by any test, uncommitted, and uses one breakpoint, not three. Flagging so it isn't
silently carried into a new 2.1 branch as an unrelated diff, and so it isn't lost either — it's
real, unfinished work, independent of Gate 2.0.

**Conclusion.** Nothing above blocks 2.1 as scoped and approved. H.1–H.3 confirm the spec's existing
claims hold against the live repo, unchanged. H.4 and H.5 are load-bearing for 2.1 specifically and
should be treated as required fixes/preconditions before or during 2.1, not follow-up items: the
migration needs its own extension statement, and the second project needs to exist before that
migration can run against it. H.6–H.8 are adjacent findings, none blocking, surfaced because they
were discovered doing this check, not because they were the object of it.

## §I. Gate 2.1 pre-branch conflict check — sub-phase 2.2 (`audit_logs` migration), added before any
2.2 branch, mirroring §H's own convention

2.1's two commits (`docs: Gate 2.0 client-portal spec...` / `feat(db): Gate 2.0 sub-phase 2.1...`)
are now on `feat/permitfield-phase-2.1-client-portal-schema`, not pushed. Before moving to 2.2
(`GATE_2_0_SPEC.md` §4/§6: `alter column ... drop not null` + `add column external_actor_id` +
`add column external_actor_label` + the `audit_logs_actor_exactly_one_populated` /
`audit_logs_external_actor_label_requires_id` CHECKs on the main project's `audit_logs` table), this
section checks §4's claims against the live repo the same way §H checked §2's.

**I.1 — §4's cited current schema is byte-accurate.** Re-read `20260806000018_lifecycle_rbac_roles_and_audit_log.sql`
directly: the `create table audit_logs (...)` block matches §4's quoted version column-for-column
(`actor_user_id uuid not null references auth.users(id)`, `actor_role org_role not null`, no other
NOT NULL columns besides `org_id`/`action`/`entity_type`). Grepped every migration for `audit_logs`
across the full `supabase/migrations/` directory: only `20260806000018` touches its DDL (`create
table`, indexes, RLS, triggers, grants) — `20260806000019/21/22/24/25/27` reference it only in
comments or as an INSERT target, never `ALTER TABLE`. §4's "current schema... unchanged since" claim
holds exactly.

**I.2 — The "every existing row already satisfies the new CHECK" claim is provably true, not just
plausible.** `actor_user_id` is `not null` *today*, before this migration runs — no live row could
possibly violate a CHECK that only newly permits a second, alternate branch. This holds regardless
of what data exists in any environment; it does not depend on inspecting live rows (which this
environment can't do — no reachable Postgres instance, same limitation as §H).

**I.3 — Real gap: §4 undercounts `audit_logs`'s existing write paths, though the gap doesn't break
anything.** §4's guarantee-table row for "write-path integrity" names exactly two paths —
`authenticated` self-attributed insert (`audit_logs_insert` policy) and `service_role` (future
bridge layer, bypasses RLS). Grepping actual `insert into audit_logs` call sites found a third,
already-live path §4 never mentions: two `security definer` SQL functions —
`override_readiness_check()` (`20260806000025_readiness_checklist.sql` L306–315) and
`review_project_permit_requirement()` (`20260806000027_permit_requirements_evaluator.sql`
L431–439) — insert directly, running as the function owner (not as `authenticated`, so
`audit_logs_insert`'s policy is not what authorizes these writes at all). Both always pass a
resolved `auth.uid()` and a non-null `v_role` for `actor_user_id`/`actor_role`, so neither write
can ever land in a state the new CHECK would reject — this is not a data-integrity conflict, the
migration is still safe to apply as written. It is a documentation-completeness gap in §4 itself:
the guarantee table's two-path framing was incomplete before this check, now corrected here rather
than carried forward silently into 2.2's implementation.

**I.4 — Real, pre-existing conflict: `docs/PERMISSIONS.md`'s "zero call sites" claim for
`writeAuditLog()` is already false, independent of anything Gate 2.0 does.** §4's closing paragraph
says this gate "changes `docs/PERMISSIONS.md`'s... claim that `writeAuditLog()` has zero call
sites" and that this gate's own delivery report must be the one to update it. That premise assumes
the claim is accurate today. It is not: `app/(app)/projects/new/actions.ts` (Phase 1.1's
`createProjectAction`, L9 imports `writeAuditLog`, L155 calls it with `actorUserId`/`actorRole`
always populated from `requireOrgContext()`) is a real, live call site, confirmed by direct file
read — yet `docs/PERMISSIONS.md`'s "Current status" section (L387–389) still reads: *"`lib/audit/log.ts`'s
`writeAuditLog()` is infrastructure only. No existing route calls it... it has no writers in this
codebase yet."* This is the same class of drift `GATE_2_0_FINDINGS.md` §0.1 already corrected for a
different claim in this same file — stale documentation, not a schema or migration risk. It does
not block 2.2 (the migration itself is unaffected either way), but 2.2's delivery report should not
frame itself as "the first thing to falsify this claim" — the claim is already falsified, by
unrelated Phase 1.1 work, and the report should say so plainly rather than repeating §4's now-dated
framing.

> **Closure — Owning sub-phase: 2.2. Status: Not executed at 2.2.** `cbdfe27` (2.2's commit) touches
> only the migration and its SQL test, not `docs/PERMISSIONS.md`. Survived 2.3 and 2.4 untouched, then
> actively re-asserted (not just left stale) by §M.4(b) below, without §M.4 cross-referencing this
> finding. Finally executed at 2.5, this retrofit, `aaf4cef`.

**I.5 — No naming collisions.** Grepped the full repo for `external_actor_id`, `external_actor_label`,
`audit_logs_actor_exactly_one_populated`, `audit_logs_external_actor_label_requires_id`: zero hits
outside `GATE_2_0_SPEC.md` itself. Clean to implement exactly as named.

**Conclusion.** Nothing above blocks 2.2 as scoped. I.1/I.2/I.5 confirm §4's schema-level claims
hold exactly against the live repo. I.3 and I.4 are both real findings but neither is a migration
risk — I.3 is a documentation-completeness gap in §4 itself (an incomplete write-path list, now
corrected here), and I.4 is a pre-existing, unrelated docs-drift bug that 2.2's delivery report
should correct accurately rather than inherit §4's assumption about it. §7's TTL/role-tier/
rate-limiting items remain out of 2.2's dependency path — none of them touch `audit_logs`'s schema.

## §J. Gate 2.2 pre-branch conflict check — sub-phase 2.3 (`application_documents` `service_role`
grant), added before any 2.3 branch, mirroring §H/§I's own convention

2.2's own commit is merged to `main` (fast-forward, verified by tip-hash comparison). Before moving
to 2.3 (`GATE_2_0_SPEC.md` §5/§6: `grant insert on application_documents to service_role;`), this
section checks §5's claims against the live repo the same way §H checked §2 and §I checked §4. No
code, schema, migration, or component change was made to produce this section either.

**J.1 — §5's central claim is confirmed accurate as of current HEAD (`2a76f49`): `service_role`
still has only `select, update` on `application_documents`, no `insert`.** Re-read
`20260806000015_service_role_grants.sql` directly: `grant select, update on application_documents
to service_role;`, unchanged since H.2 first flagged this. Grepped every migration from
`20260806000016` through the current tip for any statement touching a grant on
`application_documents`: none exists. `20260806000022`, `20260806000025`, `20260806000026`, and
`20260806000028` all reference `application_documents` (an FK column, a comment, an FK column, and
a read-only aggregate function respectively) but none issues `GRANT`/`REVOKE` against it. H.2's
finding is still exactly correct today, not stale — the gap §5 is written to close is still open,
unpatched, and 2.3's proposed migration is the first thing in this repo's history that would close
it.

**J.2 — `20260806000024_lifecycle_documents_revisions.sql` (merged well after §5 was presumably
drafted) restructured this table's write paths substantially, but its own header comment
explicitly reconfirms the exact grant §5 depends on, rather than silently invalidating it.** That
migration (a) drops `application_documents_delete` and revokes `authenticated`'s table-level
`DELETE`, replacing hard delete with the SECURITY DEFINER `archive_application_document()` RPC; (b)
adds a SECURITY DEFINER `replace_application_document()` RPC as the only sanctioned post-upload
UPDATE path; (c) adds an `AFTER INSERT` trigger, `application_documents_seed_revision`, that seeds
a `document_revisions` row via the SECURITY DEFINER `seed_document_revision()` function on every
row insert, regardless of which role performed the INSERT. None of this touches INSERT itself —
line 151's comment states the initial-upload path is still "the existing
`application_documents_insert` RLS policy (`app/api/documents/route.ts`, unchanged by this
migration)," and lines 427–433 close with an explicit statement that `service_role` is "unaffected
by this migration. It keeps its existing `select, update on application_documents` grant
(`20260806000015`)... since neither the columns they touch nor that grant were altered here." This
is not a conflict with §5 — it is the exact fact §5 asserts, independently corroborated by a
migration §5's own text doesn't cite. Worth recording as positive confirmation rather than a gap.

**J.3 — One real, non-blocking documentation-completeness gap: §5 doesn't mention that a
`service_role` INSERT will also fire `application_documents_seed_revision`, seeding a
`document_revisions` row automatically.** This is very likely the desired behavior for
`uploadDocument` (2.5) — a portal-originated upload should have the same revision history as an
`authenticated`-originated one — but §5's text, written before `20260806000024` presumably, doesn't
account for it, and 2.5's implementation should not treat the resulting `document_revisions` row as
a surprise. Related: `application_documents.uploaded_by` and `document_revisions.uploaded_by` both
default to/accept `auth.uid()`, which resolves to `NULL` for a `service_role` caller with no
Supabase Auth session context (exactly the client-portal bridge layer's situation, per §3 — there is
no `auth.users` row for an external token-holding recipient in project 1 at all). Both columns are
nullable with no NOT NULL constraint added by `20260806000024` (confirmed by direct read of the
`alter table`/`create table` blocks), so this does not fail — but it is worth 2.5's delivery report
noting explicitly, the same way I.4 flagged a claim worth stating plainly rather than leaving
implicit.

> **Closure — Owning sub-phase: 2.5, orphaned when first found (owning sub-phase closed, action never
> executed, not caught by §M). Reassigned owner: this retrofit (§N). Status: Investigated and closed
> in the same commit as this retrofit.** Checked directly rather than left as an open question: `application_documents`'s
> `uploaded_by` and `document_revisions.uploaded_by` are both nullable with no NOT NULL constraint
> (`20260806000024`), `document_revisions_select`'s RLS policy does not reference `uploaded_by` at all
> (org-membership join only, confirmed by direct re-read), and a repo-wide grep of `app/` and `lib/`
> found **zero** references to `document_revisions` or `uploaded_by` anywhere in application code —
> nothing reads either today. Conclusion: cosmetic, not a data-integrity risk, as of this check. Not
> permanently closed, though — flagged forward: the first future work that builds a revision-history UI
> or otherwise reads `document_revisions.uploaded_by` must handle a null value gracefully for
> portal-originated uploads (render "client portal," not a broken user lookup), and that future
> sub-phase inherits this note as its own precondition, the same way 2.4 inherited K.1's grants gap.

**J.4 — §5's Inngest-caller claim re-grep-confirmed against current file contents, not just
recalled.** `lib/inngest/functions/extract.ts`: `.from('application_documents')` appears at L47
(`.select('id, storage_path, original_filename, mime_type')`) and L102
(`.update({ text_layer_chars: ... })`) — select and update only.
`lib/inngest/functions/audit.ts`: `.from('application_documents')` appears once, L88
(`.select('doc_kind')`) — select only. Neither file calls `.insert()` against this table anywhere.
§5's "neither gains any new capability it uses" claim holds exactly.

**J.5 — §5's `lib/storage/documents.ts` reuse claim holds.** `isAllowedMimeType` (line 23) and
`MAX_FILE_SIZE_BYTES` (line 7) are both still exported under those exact names, confirmed by direct
read. `uploadDocument` (2.5, not this sub-phase) can reuse them as §5 describes without any rename.

**J.6 — No naming collisions.** The literal grant statement `grant insert on application_documents
to service_role;` does not exist anywhere in `supabase/migrations/` today (confirmed by grep across
the full directory) — 2.3 is additive, not a duplicate of an already-applied grant.

**Conclusion.** Nothing above blocks 2.3 as scoped. J.1 reconfirms H.2's gap is still live and still
exactly what 2.3's single GRANT statement closes. J.4–J.6 confirm §5's supporting claims (Inngest
caller scope, `lib/storage/documents.ts` exports, no naming collision) hold exactly against the
current repo. J.2 is not a conflict — `20260806000024`, merged independently of this gate, already
corroborates §5's "no existing behavior changes for any existing caller" claim in its own words. J.3
is the only real gap found, and it is a documentation-completeness note for 2.5's delivery report
(the automatic `document_revisions` seed row and null `uploaded_by` on portal-originated uploads),
not a blocker for 2.3's narrow grant change itself.

## §K. Gate 2.3 pre-branch conflict check — sub-phase 2.4 (bridge layer, §3's five read operations),
added before any 2.4 branch, mirroring §H/§I/§J's own convention

2.3's own commit is merged to `main` (fast-forward, verified by tip-hash comparison). Before moving
to 2.4 (`GATE_2_0_SPEC.md` §3/§6: `lib/bridge/client-portal.ts` implementing `resolveToken`,
`getApplicationSummary`, `getReadinessChecklist`, `listDocuments`, `getDocumentDownloadUrl` — the
five read operations; `uploadDocument` is 2.5, not this sub-phase), this section checks §3's table
and its structural-enforcement design against the live repo the same way §H/§I/§J checked §2/§4/§5.
No code, schema, migration, or component change was made to produce this section either.

**K.1 — Real, blocking gap for 2.4 as scoped: `service_role` has zero privilege on three of the
tables the five read operations depend on.** Grepped every `grant ... to service_role` statement in
`supabase/migrations/` (full list, not a sample): `organizations`, `application_status_history`, and
`readiness_checklist_items` have never once been granted to `service_role`, by any migration, at any
point. Only `authenticated` has ever received a grant on any of the three —
`grant select, insert, update, delete on organizations to authenticated;` (`20260806000011` L12),
`grant select on application_status_history to authenticated;` (`20260806000022` L339),
`grant select, insert, update, delete on readiness_checklist_items to authenticated;`
(`20260806000025` L149). `service_role`'s `BYPASSRLS` attribute does not substitute for this —
`20260806000015`'s own header comment establishes exactly that lesson, having caught the identical
bug for the Inngest functions ("service_role... is NOT a superuser and holds no table-level
privileges of its own; GRANT is an entirely separate permission layer that BYPASSRLS does not
touch"). As the schema stands today, `resolveToken` (needs `organizations.name` for `orgName`),
`getApplicationSummary` (needs `application_status_history` for `statusHistory`), and
`getReadinessChecklist` (needs `readiness_checklist_items` entirely) would each fail on their first
query with `permission denied for table ...`, in every environment, the moment 2.4's code runs
against a real database. Three additive `grant select on <table> to service_role;` statements
(mirroring `20260806000015`'s own shape and header-comment discipline exactly) are a hard
precondition for 2.4, the same way `pgcrypto` was a hard precondition for 2.1 (H.4) — not a
follow-up item.

> **Closure — Owning sub-phase: 2.4. Status: Executed, `6095576`.**

**K.2 — The other tables these operations touch are already correctly granted; no gap there.**
`permit_applications` and `application_documents` both have `select` (`20260806000015` L30–31,
and now `insert` on the latter as of 2.3); `properties` and `projects` both have
`select, insert, update` (`20260806000019` L267–268). Confirmed by direct grep, not assumed by
extension from K.1's finding — these four were already right before this check, and remain right
after it.

**K.3 — Real, non-blocking documentation-drift gap: §2's "it never hard-deletes today, only
archives" claim about `permit_applications` is inaccurate as of the live schema, understating a risk
that is actually already live, not merely future-proofed against.** `permit_applications_delete`
(`20260806000006` L71–73, `for delete to authenticated ... using (is_org_owner(org_id))`) plus
`grant select, insert, update, delete on permit_applications to authenticated;`
(`20260806000011` L15) are both live and unrevoked — grepped every later migration for any statement
touching either; none exists, unlike `application_documents_delete`, which `20260806000024`
explicitly dropped for that table. A hard delete of a `permit_applications` row today — by any
org owner, through the existing UI, cascading to every FK-linked child row — is a real, present-day,
reachable path, not the hypothetical §2's "the bridge layer does not get to assume that invariant
holds forever" hedge frames it as. This does not change the design: the live re-check (§2's own
mechanism) already correctly returns "not found" for a deleted row either way, regardless of whether
the deletion path is hypothetical or live. But 2.4's delivery report, and any future revision of §2,
should describe this as a live invariant the re-check actively defends against today, not a
forward-looking precaution — the same class of correction I.4 already made for a different claim in
§4.

> **Closure — Owning sub-phase: 2.4, orphaned when first found (owning sub-phase closed, action never
> executed). Reassigned owner: this retrofit (§N). Status: Executed, same commit as this retrofit.**
> `GATE_2_0_SPEC.md` §2 now describes the `permit_applications` hard-delete path as live and unrevoked
> today (citing `20260806000006`'s `permit_applications_delete` policy and `20260806000011`'s
> `DELETE` grant to `authenticated`, both still unrevoked, confirmed by direct re-read), not a
> forward-looking hedge — the framing this finding flagged is corrected, not just flagged again.

**K.4 — Real, non-blocking design gap: §3's own text is internally inconsistent about
`propertyAddressSummary`'s granularity, and neither reading has a clean, always-reachable schema
source.** The `resolveToken` table cell states the field is "(city/province only)," but the same
cell's illustrative rendering — *"...viewing your application for 123 Main St"* — is a street-level
address, not a city/province summary; the two clauses describe different granularities within one
table cell. Tracing either reading against the live schema surfaces a further, real gap:
`permit_applications.project_address` (`20260806000006` L23) is a single `not null` free-text field
with no city/province decomposition — the only structured split
(`properties.city`/`properties.province_code`, `20260806000019` L115–116) is reachable only via
`permit_applications.project_id -> projects.property_id -> properties`, and `project_id` is
deliberately, permanently nullable: `20260806000023`'s own header states its NOT NULL follow-up is
written but deliberately unshipped (`supabase/migrations_blocked/20260806000023b`), specifically
because `createApplicationAction` (`app/(app)/applications/new/actions.ts` L12, L78–90, read
directly) is a live, currently-open code path whose `.insert({..., project_address: projectAddress,
...})` call supplies `project_address` but never `project_id` at all. Any application created
through that still-open path — a real, ongoing possibility, not a historical-only edge case — has no
`properties` row to derive a structured city/province summary from, at any granularity. 2.4 needs to
decide and document which source each field actually reads (most likely: "full property address" =
`project_address` directly, unparsed; `propertyAddressSummary` = a derived prefix/truncation of
`project_address` itself, not a `properties` join, since that join is not guaranteed to exist for
every token-eligible row) before writing the query, not discover the gap mid-implementation or
mid-test.

> **Closure — Owning sub-phase: 2.4. Status: Executed, `3645a4c`.** `summarizeAddress()` in
> `lib/bridge/client-portal.ts`, with a comment citing this as its "K.4 resolution."

**K.5 — The structural-enforcement mechanism's two preconditions are both still entirely unbuilt,
exactly as H.5/H.6 already flagged before 2.1 and unchanged since — not a new conflict, but still
open and squarely 2.4's to close.** Confirmed by direct check: no `lib/bridge/` directory exists;
`lib/supabase/` holds only `client.ts`/`server.ts`/`service-client.ts`, all scoped to project 1, no
second-project service-role client module anywhere; `eslint.config.mjs` has no existing
`no-restricted-imports` (or equivalent single-importer) precedent to extend — 2.4 would be
originating this mechanism, not reusing one; `.env.example` still has zero second-project entries;
`lib/flags.ts` has no `PERMITFIELD_FF_CLIENT_PORTAL` flag yet, confirmed by direct read. None of this
blocks 2.4 — it is exactly what 2.4 is scoped to build — but H.6's credential-naming decision is
still undecided and should be made explicitly as part of 2.4's own delivery, not left implicit again.

> **Closure — Owning sub-phase: 2.4 (restates H.6). Status: Executed, `40fa7a2`.**

**K.6 — No naming collisions.** Grepped the full repo for `resolveToken`, `getApplicationSummary`,
`getReadinessChecklist`, `listDocuments`, `getDocumentDownloadUrl`, `PERMITFIELD_FF_CLIENT_PORTAL`:
zero hits anywhere outside `GATE_2_0_SPEC.md` itself. Clean to implement exactly as named.

**Conclusion.** K.1 is a real blocker for 2.4 as scoped, not previously surfaced by §H/§I/§J (none of
which touched these three tables' grants) — three additive `grant select ... to service_role;`
statements are a hard precondition, the same class of precondition H.4's `pgcrypto` gap was for 2.1.
K.2 confirms the other four tables these operations touch are already correctly granted. K.3 and K.4
are both real findings but neither is a schema risk — K.3 is documentation drift in §2 that
understates an already-live risk (framing correction only, the design itself is already correct),
and K.4 is a genuine pre-implementation design question (which column/join `propertyAddressSummary`
and "full property address" actually read) that needs an explicit answer before 2.4 writes the
query, not an assumption carried in silently. K.5 restates H.5/H.6's still-open preconditions,
unchanged since 2.1 and squarely 2.4's own scope to close. K.6 confirms no naming collision.

---

## §L. Gate 2.4-pre-grants pre-branch conflict check — sub-phase 2.4 proper (bridge module, §3's
five read operations, structural enforcement, credential isolation), added before any 2.4
implementation branch, mirroring §H–§K's own convention

`20260806000032_bridge_read_grants.sql` (K.1's fix) is merged to `main` (fast-forward, verified by
tip-hash comparison), as is the one-line `occurred_at` → `created_at` correction to §3 itself. Before
2.4's implementation branch (`lib/bridge/client-portal.ts`: `resolveToken`, `getApplicationSummary`,
`getReadinessChecklist`, `listDocuments`, `getDocumentDownloadUrl` — `uploadDocument` remains 2.5,
out of scope here), this section re-checks §3's structural-enforcement design and its five read
operations' column claims against the live repo, exactly as instructed: three specific areas, no
code/schema/migration/component change made to produce this section, no branch opened.

**L.1 — The lint rule is unbuilt but structurally buildable; the credential-isolation control cannot
exist yet because no deploy target of any kind exists in this repo — not even for project 1 itself.**
`eslint.config.mjs` (read in full) is a flat config (`defineConfig` from `eslint/config`) currently
consisting of `nextVitals`, `nextTs`, and a `globalIgnores` block — zero `rules` overrides anywhere,
zero precedent for `no-restricted-imports` or any other custom rule. Nothing prevents 2.4 from adding
one (flat config supports per-`files` rule objects, which is exactly the shape §3's "scoped to
`overrides` for every path except that one file" design needs), but it does not exist today, matching
K.5's finding exactly.

The second control is a different, harder gap than "unbuilt": it has **no target to attach to**.
Confirmed by direct check, not inference — no `vercel.json` anywhere in the repo; `.github/workflows/`
contains only `ci.yml`, which has zero "deploy"/"vercel" matches on grep; `next.config.ts` is the
unmodified scaffold default (`{}`, no `output` mode); a repo-wide grep for "vercel" outside
`.env.example`/docs matches only `package-lock.json` (a transitive dependency listing, not an
integration). There is no serverless function group, no separate env-var scope, no deploy pipeline of
any kind — for the client-portal bridge or for the main app it would sit beside. §3's own text
describes credential isolation as depending on "whichever deploy target runs
`lib/bridge/client-portal.ts`" — that target does not exist, so the sentence has no referent yet.

This means §3's "two mechanisms, not one" framing is not currently achievable as designed. Per the
explicit instruction to say so if the second control can't exist yet: it can't, and until it does, a
lint rule is the entire boundary — a single, disableable, build-time-only convention doing the job
§3 assigns to two independent layers. This is not a reason to block 2.4 (the lint rule is real and
worth building regardless), but 2.4's delivery report should state plainly that credential isolation
is deferred to whenever a deploy target is chosen, not implied as already covered by §3's prose.

> **Closure — Owning sub-phase: 2.4.**
> **L.1(a) (lint rule) — Status: Executed, `40fa7a2`.** `no-restricted-imports` rule added to
> `eslint.config.mjs`.
> **L.1(b) (state plainly that credential isolation is deferred) — Status: Executed**, persisted in
> code comments, not just a delivery-report sentence: `lib/bridge/client-portal.ts:21`,
> `lib/supabase/client-portal-service-client.ts:21`, `eslint.config.mjs:8`.

**L.2 — All five read operations' claimed columns exist, with the exact names claimed, on the tables
claimed — one previously-fixed exception, one previously-flagged ambiguity now confirmed to affect a
second operation, no new defects.** Checked field-by-field against the live migrations that define
each table, not against §3's own prose:

- `resolveToken` → `applicationId`, `orgName`, `propertyAddressSummary`, `recipientName`. `orgName`
  reads `organizations.name` (`20260806000011`, now grant-covered per K.1/§L's own predecessor). The
  other three fields are token-row-derived or address-derived (see below) — no defect.
- `getApplicationSummary` → `permitStatus` (`permit_applications.permit_status`, `permit_status_enum`,
  confirmed `20260806000022` L149), `projectTitle` (`permit_applications.project_title`, confirmed
  `20260806000006` L22), full property address (see below), `statusHistory` (`to_status`,
  `created_at` from `application_status_history` — the K.1-fixed column; `20260806000022` L291-311
  defines the table with `created_at`, no `occurred_at` column ever existed on it). No remaining
  defect on this row.
- `getReadinessChecklist` → `{ title, isRequired, status }` from `readiness_checklist_items`. All
  three confirmed as real columns (`title`, `is_required`, `status` of type `readiness_item_status`)
  on the table `20260806000025` defines, and exercised directly by `bridge_read_grants.test.sql`'s own
  assert step. No defect.
- `listDocuments` → `{ id, originalFilename, docKind, status, uploadedAt }` from
  `application_documents`. `id`, `original_filename`, `doc_kind`, `uploaded_at` are base columns
  (`20260806000006` L35-49); `status` (`document_review_status` enum) was added by
  `20260806000024` L73-100, the same migration that adds `archived_at`. All five confirmed real. No
  defect.
- `getDocumentDownloadUrl` → scope check via `application_documents.application_id` (base column,
  same migration as above) plus "must not be archived," which reads the same migration's
  `archived_at` column, confirmed non-null-checkable. The signed URL itself is not a new pattern to
  invent: the existing convention (`app/(app)/applications/[id]/page.tsx` L142, L149) is an inline
  `supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS)` call, with
  `SIGNED_URL_TTL_SECONDS = 300` a page-local constant (L13) — not exported or shared. 2.4 can reuse
  the same call shape but has no existing shared helper to import; that constant will need to be
  either duplicated or extracted, a small implementation decision, not a schema gap.

The one column-name defect this pass would have caught (`occurred_at`) was already found and fixed
before this section was opened (`5777ffa`) — confirmed resolved by direct re-read of the current L446
table cell. The one open ambiguity is not new: K.4 already flagged `propertyAddressSummary`'s
granularity and sourcing as unresolved (`project_address` is single free-text;
`properties.city`/`province_code` is reachable only through a permanently-nullable `project_id`).
This pass confirms the identical ambiguity also applies to `getApplicationSummary`'s "full property
address" field, not only `resolveToken`'s summary — both fields read from the same
under-specified source, so this is K.4 extended to a second call site, not a second, independent
defect.

**L.3 — What the bridge connects to: project 1 is buildable and testable today, locally and in CI;
project 2 has a local CI-wired throwaway stack but no live remote instance and no credentials
anywhere, so nothing can be built or tested against a real second project yet; and no application-level
(TypeScript/vitest) test infrastructure exists for exercising a live Supabase connection on either
project.** Three separate facts, checked independently:

- Project 1 (`organizations`, `application_status_history`, `readiness_checklist_items`,
  `application_documents`, `permit_applications`) is fully reachable via `supabase start` locally and
  via `ci.yml`'s existing `build-and-test`/`sql-tests` jobs — the same stack every prior sub-phase's
  SQL tests, including `bridge_read_grants.test.sql`, already exercise.
- Project 2 (`client_access_tokens` and its siblings, `supabase-client-portal/supabase/migrations/
  20260814000001_client_portal_token_schema.sql`) has no live remote instance and no credentials
  provisioned anywhere — matching the user's own earlier statement in this session ("When 2.4 needs
  it, I'll create the project and paste values into my own local `.env` and GitHub secrets myself").
  `.env.example` still has zero second-project entries, confirmed by direct re-read. It does,
  however, already have a local, throwaway, CI-wired stack: `ci.yml` runs
  `supabase --workdir supabase-client-portal start` / `db reset` / `npm run test:sql:client-portal`
  as a second, independent job step (lines 109-131) — that stack can be built and SQL-tested against
  today, the same way project 1 can. What it cannot do is stand in for the real, credentialed project
  2 instance token issuance/validation is ultimately meant to run against — this is a real, live
  schema to develop and SQL-test against, not a substitute for the eventual production project.
- Neither project has application-level (non-SQL) test coverage today. `vitest.config.mts`'s own
  header comment states it is deliberately minimal — "no Next.js/React plugin, no jsdom environment"
  — and all 6 existing `*.test.ts` files (`lib/jurisdictions/staleness.test.ts`,
  `lib/intake/schemas.test.ts`, `lib/entitlements/index.test.ts`, `lib/authz/index.test.ts`,
  `lib/authz/permissions-doc.test.ts`, `lib/permit-status/transitions.test.ts`) are pure-function
  tests with no Supabase dependency. This means 2.4's five read operations, once written as
  TypeScript in `lib/bridge/client-portal.ts`, have no existing vitest pattern to test against a live
  instance the way `bridge_read_grants.test.sql` tests grants directly in SQL — 2.4 will need to
  either extend `vitest.config.mts` or rely on SQL-level testing plus manual/integration verification,
  a decision this section flags but does not make.

> **Closure — Owning sub-phase: 2.4. Status: Executed**, `vitest.live.config.mts` added, `fac3cae`.

**Conclusion.** No blocker equivalent to K.1 surfaced in this section — the grants gap that blocked
2.4 was already closed before this section opened. What this section finds instead is a materially
weaker starting position than §3's prose implies on exactly the point the instruction anticipated:
the structural-enforcement mechanism is described as two independent layers, but only one (the lint
rule) can be built at all right now, because the second (credential isolation) has no deploy target
to scope itself to, for this app or any part of it. L.2 finds the five read operations' column claims
are otherwise sound — one defect already fixed, one pre-existing ambiguity (K.4) now confirmed to
span two fields instead of one, nothing new. L.3 finds project 1 fully buildable/testable today, a
throwaway project-2 stack already wired into CI and usable for SQL-level development the same way,
but no real project-2 credentials anywhere and no application-level test infrastructure for either —
2.4 can be built and SQL-tested against both local stacks, but cannot be tested against a live,
credentialed project 2, and has no vitest precedent for testing the TypeScript layer itself against
either. None of this blocks 2.4 from starting; all of it should be named in 2.4's own scope before
work begins, the same way K.1 through K.6 were named before 2.4-pre-grants.

## §M. Gate 2.4 pre-branch conflict check — sub-phase 2.5 (`uploadDocument`, first `writeAuditLog()`
call site, storage path), added before any 2.5 implementation branch, mirroring §H–§L's own convention

2.4 (`lib/bridge/client-portal.ts`'s five read operations) is merged to `main` (fast-forward,
`d26c9d2`, tip-hash verified against `headRefOid`) with CI green, including the branch's own live-Node
finding (Node 20 → 22, `supabase-js`'s `realtime-js` requires native `WebSocket`) fixed in the same
merge. Before 2.5's implementation branch (`uploadDocument`; §4's `writeAuditLog()` call site; §5's
storage path), this section re-checks the state the prior sections left undecided or deferred, exactly
as instructed: three specific areas, no code/schema/migration/component change made to produce this
section, no branch opened.

**M.1 — Both of 2.5's schema/grant prerequisites (2.2, 2.3) are already merged to `main`, exactly
matching §4/§5's design, with no drift.** Checked by direct read of the live migrations, not by
assuming the sub-phase table's sequencing was honored:

- `20260806000030_audit_logs_external_actor.sql` (2.2, §4) is live: `actor_user_id`/`actor_role` both
  nullable, `external_actor_id`/`external_actor_label` added, both CHECK constraints present under the
  exact names §4 specifies (`audit_logs_actor_exactly_one_populated`,
  `audit_logs_external_actor_label_requires_id`), plus a `do $$ ... raise exception` sanity block
  proving zero existing rows would violate the new CHECK — the same discipline §6's 2.2 row requires,
  already executed at migration time rather than left to a separate test file to catch first.
- `20260806000031_application_documents_service_role_insert.sql` (2.3, §5) is live: a single additive
  `grant insert on application_documents to service_role;`, with its own header comment confirming (via
  a re-grep of `lib/inngest/functions/{extract,audit}.ts`) that no existing `service_role` caller gains
  an unused capability, and confirming `application_documents_insert`'s RLS `with check` is irrelevant
  to `service_role` (`BYPASSRLS`), matching §5's "the GRANT is the entire enforcement surface" claim
  exactly.

Both migrations cite their own originating findings sections (§I, §J) inline, which this check
independently re-confirms rather than takes on faith. 2.5 does not need to design or migrate anything
schema-side — both prerequisites §6's table lists as dependencies are already satisfied on `main`.

**M.2 — `writeAuditLog()` cannot write an external-actor row today; this is a real, load-bearing gap,
not a hypothetical one, and 2.5 cannot satisfy §6(b)'s test requirement without extending it first.**
Read in full (`lib/audit/log.ts`). Its `AuditLogEntry` interface declares `actorUserId: string` and
`actorRole: Role` as required fields — not optional — and the function body unconditionally maps them
to `actor_user_id`/`actor_role` on every insert; there is no `externalActorId`/`externalActorLabel`
field anywhere in the interface, and no branch in the insert body that would ever populate
`external_actor_id`/`external_actor_label`. Concretely: there is no way to call this function today
that produces a row satisfying `audit_logs_actor_exactly_one_populated`'s external-actor branch
(`actor_user_id is null and actor_role is null and external_actor_id is not null`) — every call is
structurally forced down the internal-actor branch, or fails a required-field TypeScript error before
it compiles. This gap is invisible until 2.5 tries to use it, exactly the shape of gap this
pre-branch-check convention exists to surface first.

The fix is additive, not a redesign: widen `AuditLogEntry` so `actorUserId`/`actorRole` become
optional and add optional `externalActorId`/`externalActorLabel`, then branch the insert body between
the two shapes the CHECK already enforces at the DB layer (mirroring the constraint's own two-branch
structure, so the TypeScript shape and the SQL CHECK can't silently diverge). One adjacent question
this section flags but does not decide: whether to make this a hard runtime assertion (throw if neither
or both shapes are populated) in addition to the type-level optionality, so a caller bug surfaces at
the `writeAuditLog()` call site rather than as a CHECK-violation Postgres error surfaced from inside a
bridge operation.

The function's *client* parameter is not part of this gap, despite the header comment's framing. That
comment states the function "takes the caller's own session-scoped Supabase client... rather than
instantiating one itself or accepting a service-role client" and frames this as deliberate, written
when every caller was an `authenticated` Route Handler. But the function body itself has no
session-specific behavior — it calls `supabase.from('audit_logs').insert(...)` on whatever client
object it's given. `uploadDocument` will call this from the bridge layer as project 1's `service_role`
client (`lib/supabase/service-client.ts`, the only way to write an external-actor row at all, since no
`authenticated` session exists for a client-portal recipient in project 1), and nothing in the function
body prevents that — `service_role` bypasses `audit_logs_insert`'s RLS check entirely (`BYPASSRLS`),
same as every other `service_role` write in this schema. The header comment's "deliberate" framing
should be corrected to describe *both* legal callers once 2.5 adds the second one, not left to imply
a restriction the code was never actually enforcing.

> **Closure — Owning sub-phase: 2.5. Status: Executed, `2a3ad6f`.** `AuditLogEntry` widened, the
> insert body branched, the header comment corrected. Partial: the adjacent "hard runtime assertion"
> question this finding flags but doesn't decide was resolved implicitly (no guard added, the DB
> CHECK is the sole enforcement) but never explicitly recorded anywhere as an answer to that question
> — flagged here rather than treated as a separate open item, since the code path it would have
> guarded is the same one M.2 already closed.

**M.3 — No gap on the storage write path; every helper `uploadDocument` needs already exists with the
exact names/signatures 2.4's own live test already exercises, and `service_role`'s Storage access needs
no new grant.** `storage.objects`' RLS policies (`20260806000013_storage_buckets.sql`) are scoped to
`to authenticated` only (`uploads_select`/`uploads_insert`/`uploads_delete`); that migration's own
header comment already states the reason no `service_role` policy exists: the Storage API's
service-role key bypasses `storage.objects` RLS entirely, the same mechanism (not a coincidence of
naming) as `service_role`'s Postgres-level `BYPASSRLS`. `uploadDocument` needs no new bucket grant or
policy, matching §5's own claim ("no new `storage.objects` RLS policy is needed... the bridge layer's
`service_role` storage access bypasses it the same way every other `service_role` operation in this
schema does") — this section confirms that claim against the live migration rather than repeating it.

`lib/storage/documents.ts`'s `isAllowedMimeType`, `MAX_FILE_SIZE_BYTES`, `computeSha256`,
`buildStoragePath`, and `UPLOADS_BUCKET` are all still present with the exact names §5 cites — and this
is doubly confirmed, not singly: `lib/bridge/client-portal.live.test.ts`'s own `insertDocumentFixture`
helper (2.4, merged) already imports and calls `computeSha256`/`buildStoragePath`/`UPLOADS_BUCKET`
directly to build test fixtures, so 2.4's own passing CI run is a second, independent confirmation
these helpers exist and behave as §5 describes, beyond this section's own re-read.

**M.4 — `isClientPortalEnabled()` still has zero call sites, same as 2.4's own read operations; 2.5 as
scoped by §6 does not change that, and this section states it plainly rather than leaving it implied.**
Re-grepped repo-wide: `lib/flags.ts` declares `isClientPortalEnabled()` (2.4), but no route, Server
Action, or the bridge module itself (`lib/bridge/client-portal.ts`) reads it anywhere — matching the
same "declared ahead of its consumer" pattern `lib/flags.ts`'s own header comments document for
`isLifecycleCoreEnabled()`, `isJurisdictionsEnabled()`, and others. §6 scopes 2.5 to "the
`uploadDocument` operation" — a bridge-module function, not a route or Server Action — so 2.5 does not
obviously introduce a call site either, unless 2.5's own implementation chooses to add one inside the
bridge module (an implementation decision this section flags but does not make, same discipline L.1
used for the credential-isolation gap). Left unstated, a future reader could easily assume the flag is
already enforced somewhere because it exists; this section says otherwise directly.

> **Closure — M.4(a). Owning sub-phase: 2.5. Status: Executed.** Decision recorded in `lib/flags.ts`'s
> own header comment for `isClientPortalEnabled()` (`20eb823`/`aaf4cef`).

Separately, `docs/PERMISSIONS.md`'s "`writeAuditLog()` is infrastructure only... no existing route
calls it" claim (its "Current status" section) is re-confirmed still accurate as of this check — true
today, and only becomes stale the moment 2.5's first call lands. §4 already assigns updating that file
to 2.5's own delivery report; this section does not redecide that, only confirms the claim is still
true pre-branch, so 2.5 starts from a correct baseline rather than an already-stale one.

> **Closure — M.4(b). Not an executed/not-executed item — a process failure in this check itself.**
> This paragraph re-asserts `docs/PERMISSIONS.md`'s "no existing route calls it... no writers" claim as
> "still accurate," without cross-referencing §I.4 above, which — three sections earlier in this same
> document — had already found that exact claim false (`createProjectAction`,
> `app/(app)/projects/new/actions.ts`, live since Phase 1.1). §M.4(b) is not merely a missed action; it
> is this document actively regressing a fact its own earlier section had already corrected, at the
> moment of writing (`bcbcb80`), predating the user's independent verbal repetition of the same stale
> claim during 2.5's scoping. Recorded here as a distinct failure mode from every other row in this
> retrofit — see the new convention section below for the going-forward fix (every pre-branch check
> must audit prior sections' still-open findings, not just its own sub-phase's new claims).

**Conclusion.** One real, load-bearing blocker-equivalent finding, the same severity class as K.1's
grants gap before 2.4: `writeAuditLog()`'s `AuditLogEntry` interface must be extended with optional
`externalActorId`/`externalActorLabel` (and `actorUserId`/`actorRole` made optional) before 2.5 can
write a single external-actor `audit_logs` row, let alone satisfy §6(b)'s control-then-assert test
requirement — today, no call shape exists that produces a row passing
`audit_logs_actor_exactly_one_populated`'s external-actor branch. Unlike K.1, this is not a missing
GRANT hidden behind RLS; it is a TypeScript interface gap in application code, caught here instead of
mid-implementation. M.1 finds both of 2.5's schema/grant prerequisites (2.2, 2.3) already merged and
verified matching §4/§5 exactly, so 2.5 needs no new migration. M.3 finds the storage write path and
its helper functions fully ready, doubly confirmed by 2.4's own passing tests. M.4 finds the client-
portal feature flag still uncalled anywhere, consistent with 2.5's own scope rather than a gap 2.5
introduces. None of this blocks 2.5 from starting; M.2's finding should be the first change on the 2.5
branch, before `uploadDocument` itself is written, the same way K.1's grant migration preceded 2.4's
bridge module.

---

## §N. Closure retrofit — auditing §H through §M for follow-through, and the going-forward convention
this establishes

Added after 2.5 was merged and Gate 2.0 was reported closed, per explicit instruction, scoped to this
file and `GATE_2_0_SPEC.md` only — no code, schema, or migration change. §H through §M reliably
**detect** conflicts and name follow-up actions; nothing in that convention, as written, ever
**closed the loop** on whether a named action actually executed. This section is that retrofit: every
action-naming finding in §H–§M now carries a `> **Closure —**` blockquote immediately beneath it,
stating an owning sub-phase and an executed/not-executed determination with a commit hash where
applicable. Findings that named no forward action (pure confirmations, self-contained corrections —
e.g. H.1, H.3, H.7, H.8, I.1–I.3, I.5, J.1, J.2, J.4–J.6, K.2, K.6, L.2, M.1, M.3) carry no closure tag;
they had nothing to close.

**What this audit found, net.** Sixteen findings named a forward action. Twelve executed, of which one
(H.6) executed only after slipping silently past its own named sub-phase (2.1) and being independently
re-caught by a later section (K.5) before 2.4 depended on it — a delay, not a failure, since the
process itself caught its own gap before anything downstream broke. Three were found still open with
no live owner at the point this audit was first run: **J.3** and **K.3** were orphaned — each named an
owning sub-phase (2.5 and 2.4 respectively) that was already closed, the action never executed, and no
later section re-caught either one the way K.5 re-caught H.6. **I.4** was open the same way until this
retrofit closed it directly (`aaf4cef`, this retrofit updates `docs/PERMISSIONS.md`). J.3 and K.3 were
themselves assigned owners and resolved within this same retrofit pass, below — see the "Update" note
after the outstanding-items list. The sixteenth, **M.4(b)**, is not an
unexecuted action at all — it is this document's own pre-branch check actively re-asserting a claim
(`docs/PERMISSIONS.md`'s "no writers" line) that an earlier section of this same document, §I.4, had
already found false three sections prior. That is a distinct and worse failure mode than a missed
action: not "nobody did the follow-up," but "the audit process itself regressed a previously-corrected
fact," and it is the direct reason this retrofit exists rather than a smaller fix confined to I.4 alone.

**Why the mechanism failed this way.** Every §H–§M section was written to check the *next* sub-phase's
spec claims against the live repo — a forward-looking check, by design. None of them was written to
look backward across *prior* sections' own still-open findings before letting its sub-phase proceed.
J.3 and K.3 are exactly the predictable result: each was correctly identified once, assigned to a
sub-phase that had every opportunity to close it, and then never looked at again by any subsequent
section, because no subsequent section's job was to look. M.4(b) is the same gap in a sharper form —
§M didn't just fail to re-check I.4's finding, it re-derived the original, wrong answer independently,
without ever consulting the section that had already corrected it.

**Going forward, two binding rules, effective immediately:**

1. **Every future finding that names a follow-up action must carry an "Owning sub-phase" tag at the
   moment it is written**, not retrofitted later. The tag names the sub-phase responsible and nothing
   else — it does not yet assert the action executed, only who is on the hook for it.
2. **Every future sub-phase's own pre-branch conflict-check must explicitly audit all still-open
   findings it inherits from every prior section** — not only the ones that happen to touch its own
   migration or module — and state, per inherited finding, executed or not, before that sub-phase's
   branch opens. A finding does not get to close because a later sub-phase coincidentally needed the
   same fix for an unrelated reason (the exact pattern that closed H.6, I.4, and K.4/K.5 by luck rather
   than by design); it closes because the section responsible for it checked and said so.

**Update, same commit as this retrofit's initial write-up: J.3 and K.3 both closed, per explicit
instruction not to let orphaned findings carry forward into Gate 3.0 unowned.** Both were flagged
above as needing a new owner before either was actually assigned one; both now are, and both are
resolved as of this section:

- **J.3** — `document_revisions` auto-seed / null `uploaded_by` on portal-originated uploads.
  Investigated directly (not assumed): nullable columns, no NOT NULL constraint, no RLS dependency on
  the value, and zero application-code references to either `document_revisions` or `uploaded_by`
  anywhere in `app/` or `lib/`. Cosmetic today, not a data-integrity risk — see J.3's own closure tag
  above for the full check. A forward note is recorded for whichever future sub-phase first builds a
  revision-history UI, since that sub-phase inherits the null-handling requirement as a precondition.
- **K.3** — `GATE_2_0_SPEC.md` §2's hedged framing corrected to state the `permit_applications`
  hard-delete path as live and unrevoked today, not a forward-looking possibility. See K.3's own
  closure tag above.

Both are now visible in this document's own text (their closure blockquotes above), not just
resolved in a chat transcript — that visibility, plus the actual resolution, is this update's
deliverable.
