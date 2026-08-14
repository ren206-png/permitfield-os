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

**H.5 — No second Supabase project exists yet, anywhere.** One `supabase/config.toml` in this repo,
no env-var scaffolding for a second project's URL/keys anywhere (`lib/`, `.env.example`, or
otherwise). This is the same gap §7 already named ("infra provisioning... not addressed"), but it is
not just an open question deferred to later — it is a hard precondition specifically for 2.1, since
2.1 *is* the second-project schema. The project has to exist and be reachable before its first
migration can run. Sequence this explicitly as 2.1's actual first step, not something assumed to have
happened before 2.1 "starts."

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

**H.7 — Missing rollback SQL for migration 29, found while checking H.1.** `supabase/migrations_rollback/`
(untracked, verified present) holds one rollback file per migration for all 28 migrations that
predate `20260806000029`, but none for `20260806000029` itself — confirmed by direct directory
listing, not assumed. Not a Gate 2.0/2.1 blocker (2.1 touches project 2 only, no project-1 migration
at all), but flagged because it's a live, verifiable gap in an established repo convention, found in
the course of this check rather than asserted from an unverified source.

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

**I.5 — No naming collisions.** Grepped the full repo for `external_actor_id`, `external_actor_label`,
`audit_logs_actor_exactly_one_populated`, `audit_logs_external_actor_label_requires_id`: zero hits
outside `GATE_2_0_SPEC.md` itself. Clean to implement exactly as named.

**Conclusion.** Nothing above blocks 2.2 as scoped. I.1/I.2/I.5 confirm §4's schema-level claims
hold exactly against the live repo. I.3 and I.4 are both real findings but neither is a migration
risk — I.3 is a documentation-completeness gap in §4 itself (an incomplete write-path list, now
corrected here), and I.4 is a pre-existing, unrelated docs-drift bug that 2.2's delivery report
should correct accurately rather than inherit §4's assumption about it. §7's TTL/role-tier/
rate-limiting items remain out of 2.2's dependency path — none of them touch `audit_logs`'s schema.
