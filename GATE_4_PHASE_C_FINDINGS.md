# Gate 4 — Quotes & Payments — Phase C Findings (read-only)

Scope: online payment collection for flow B (a contractor's own customer paying a PermitField-issued
invoice) via Stripe Connect — the module `GATE_4_FINDINGS.md` §2 (Stripe webhook section) and §3.1
(flag-naming section) both explicitly flagged as out of scope for Phase A/B and requiring its own
pass. **No code, schema, or migration has been written to produce this report.** Per the master
prompt's own rule ("Phase B and C each still require their own report-and-approval step before
starting," `GATE_4_FINDINGS.md` line 19) and this repo's precedent for every other gate/phase
(`GATE_4_PHASE_B_FINDINGS.md` written before Phase B's first migration; `GATE_2_0_SPEC.md` written
only after `GATE_2_0_FINDINGS.md` settled its open questions), this document exists to settle
Phase C's open questions before any migration or Stripe integration code is written — not after.

No approval token for Phase C has been received yet. This document is the required first step, not
a request to skip it — an explicit `APPROVED: PHASE 4.C` (or sub-phase tokens, e.g. `4.C.1`/`4.C.2`,
if the owner wants to split "collect a card payment" from "onboard a connected account" into
separately-gated pieces) is what would unblock implementation, following review of this document.

---

## §1. What Phases A/B already built that Phase C must not duplicate or conflict with

- **`payment_method` is a Postgres enum, not free text** (`create type payment_method as enum
  ('e_transfer', 'cheque')`, `supabase/migrations/20260806000056_payments.sql:22`). Adding an online
  method requires a real migration (`alter type payment_method add value '...'`), not a TypeScript
  union edit alone — unlike the client-portal token's `target_kind`, which Phase B's own findings
  doc (§1) confirmed is deliberately a bare text discriminator for exactly this kind of extension.
  Repo runs Postgres 17 (`supabase/config.toml:42`), so `ALTER TYPE ... ADD VALUE` outside an
  explicit `BEGIN`/`COMMIT` (the normal shape of a Supabase migration file) is not the older
  "can't run in the same transaction as its first use" hazard — safe to do in one migration, but the
  new value still can't be used in the same transaction it's added in if anyone later wraps multiple
  statements together.
- **`record_payment()` / `reverse_payment()` are the only write paths** on `payments` — there is no
  direct authenticated INSERT/UPDATE policy on the table at all (`lib/quotes-payments/payments.ts`
  header comment, confirmed against the migration). Whatever Phase C builds must still funnel
  through this RPC pair (or a deliberately-designed sibling RPC) — not a new ad hoc insert path —
  to keep the append-only, audit-logged posture Phase A established.
- **`reverse_payment()` never talks to an external processor** — it only flips the original row's
  `status` to `'reversed'` and writes an audit log entry; it does not issue a refund anywhere. An
  online payment reversed this way would leave Stripe believing the charge is still captured while
  PermitField's own ledger shows it reversed. Phase C needs either a new RPC/service function that
  calls Stripe's refund API *and then* calls (or replaces) `reverse_payment()`, or an explicit
  decision that online payments are reversed by a different, Stripe-aware code path entirely — see
  §I question 4.
- **Currency is hard-constrained to CAD** at the database level (`currency_code char(3) not null
  default 'CAD' check (currency_code = 'CAD')`, `20260806000056_payments.sql:33`, and the identical
  constraint on `invoices`). Stripe Connect Checkout in CAD against a Canadian connected account is
  the only currently-representable case — no multi-currency decision is needed for Phase C, but any
  Stripe Checkout Session created must pass `currency: 'cad'` explicitly rather than trusting a
  Stripe account default.
- **Entitlement to reuse**: `payments.manage` already exists (`lib/billing/tiers.ts:47`) and already
  gates `recordPayment()`/`reversePayment()`. §3.2 of `GATE_4_FINDINGS.md` explicitly anticipated a
  `payments.online` entitlement as the natural extension point for "online payments" as a gated
  capability, distinct from the manual-recording entitlement — worth deciding now rather than
  overloading `payments.manage` for both (see §I question 3).
- **Flag convention already reserved**: `GATE_4_FINDINGS.md` §3.1 explicitly names
  `PERMITFIELD_FF_QUOTES_PAYMENTS_ONLINE` as the proposed independent kill switch for this exact
  phase, "to satisfy the master prompt's 'never block the offline pilot on the online integration'
  requirement with a real, independently-flippable flag rather than a shared one." Confirmed this
  flag does not exist yet in `lib/flags.ts` (18 flags currently defined, none matching). Phase C
  should add it following the established `export function isXEnabled() { return
  isEnabled('PERMITFIELD_FF_...'); }` pattern, server-only (no client-readable exception applies
  here).
- **Flow-A Stripe integration confirmed structurally separate and non-reusable as-is**
  (`lib/billing/subscriptions.ts`, 357 lines, read in full this pass): subscription-mode Checkout
  Sessions for PermitField's own SaaS billing, webhook handler at
  `app/api/webhooks/stripe/route.ts` gated by `isBillingEnabled()`, only module permitted to import
  `stripe` (enforced by `eslint.config.mjs`'s `stripeClientRestriction`, an explicit `no-restricted-
  imports` block naming that exact file pair as the sole exception). Reusable *patterns*, not
  reusable *code*:
  - Lazy client construction (`getStripeClient()`) that throws only at point of use, not at import
    time, so the module can be imported even when `STRIPE_SECRET_KEY` is unset in dev/CI.
  - Redundant org/context identification on both the Checkout Session and the subscription object
    (`client_reference_id` + `metadata.org_id` + `subscription_data.metadata.org_id`) so the webhook
    can resolve identity regardless of which event/object shape it receives. Phase C's equivalent
    would need to carry `org_id` **and** `invoice_id` (and possibly `client_id`) through Stripe
    metadata the same redundant way, since a payment webhook must resolve which invoice/org a
    `payment_intent.succeeded` event belongs to without any session already open.
  - Signature verification over **raw body bytes**, never a re-serialized JSON object — a real,
    easy-to-get-wrong detail worth copying exactly, not reimplementing from memory.
  - Idempotency via comparing the incoming event's own timestamp against a stored
    "last processed" timestamp before overwriting (guards against out-of-order webhook delivery,
    which Stripe does not guarantee against). Phase C's webhook would need its own equivalent guard,
    keyed by payment/invoice rather than by org/subscription.
  - Fails closed on unrecognized status values (defaults to `'canceled'` rather than assuming
    success). Phase C's webhook handling of unrecognized/unhandled event types should keep this same
    "skip, don't guess" discipline `RELEVANT_EVENT_TYPES` already establishes for flow A.
- **Import boundary must be duplicated, not extended.** `GATE_4_FINDINGS.md` §2 already concluded
  Phase C "would be a second, structurally separate Stripe integration (likely also needing its own
  `no-restricted-imports`-style guard so flow-A and flow-B code can't accidentally cross-import)."
  Confirmed by reading `eslint.config.mjs`: the existing `stripeClientRestriction` block's `ignores`
  list is a flat two-file allowlist keyed to `lib/billing/subscriptions.ts` specifically — the
  cleanest extension is a **second, independent** `no-restricted-imports` block (or widening the
  existing one's `ignores` to include the new flow-B module path) rather than relaxing the existing
  restriction, so a future `git grep` for "who imports stripe" still cleanly separates the two flows
  by file path.
- **Customer-facing attach point confirmed**: `app/invoice/[token]/page.tsx` already has a header
  comment stating "No online payment on this page (Phase C, explicitly out of scope for this pass)"
  — i.e., this exact gap was anticipated at Phase A time. Today, when `outstandingCents > 0n`, the
  page renders a static `mailto:` link (or generic "contact us" text if the org hasn't filled in
  `org_tax_profiles.invoice_contact_email`) as the only "how do I pay this" affordance. This is the
  natural attach point for a "Pay now" button, but note the page is a `force-dynamic` **server**
  component rendered via `createServiceClient()` after `resolveTargetToken()` validates the bearer
  token — no client-side Supabase session exists on this route at all. A "Pay now" action here would
  need either a server action (posting through the same token-validated path) or a dedicated public
  API route (mirroring `app/api/public/invoice/[token]/pdf/route.ts`'s existing pattern of a public,
  token-gated route) — not a client component calling Supabase directly, since none of this route's
  existing code establishes a client-side session.
- **Token portal has a second trust boundary Phase C must respect**: `resolveTargetToken()`
  (`lib/bridge/client-portal.ts:1415`) is Gate 2.0's cross-project client-portal bridge, gated by
  **both** `isClientPortalEnabled()` **and** `isQuotesPaymentsEnabled()` before it does anything —
  tokens themselves live in a second, physically separate Supabase project ("project 2"), validated
  there, then cross-checked against "project 1" (this app's own DB) via `targetExistsInOrg()`. Any
  new Phase C server action reached from `app/invoice/[token]/page.tsx` inherits this same two-
  project trust boundary — it cannot assume a normal single-project service-role client is enough
  context to act, and per that file's own header comment, it remains "the ONLY module in this repo
  permitted to hold both projects' service-role credentials side by side," so a Phase C payment
  action should call into this module's existing resolution, not re-implement token validation.

---

## §2. Flow A vs. flow B — reconfirmed, not just inherited from Phase A/B docs

Re-verified this pass by grepping the entire repo for `stripe` (case-insensitive): every hit is
either `lib/billing/subscriptions.ts` itself, its live test file, the webhook route, the settings/
billing UI that drives it, or flag/entitlement/email plumbing that supports flow A. **Zero** hits
relate to a connected account, Stripe Connect, `application_fee`, or any contractor-customer payment
concept — flow B genuinely does not exist anywhere in this codebase yet, confirming
`GATE_4_FINDINGS.md`'s original claim still holds after Phases A and B both landed on `main`.

---

## §3. Suggested integration shape (plan, not authorization)

- **New module**, isolated the same way `lib/billing/subscriptions.ts` is today — e.g.
  `lib/quotes-payments/stripe-connect.ts` (or a small `lib/payments-online/` directory if the surface
  grows past one file: account-link creation, Checkout Session creation, webhook event handling). This
  becomes the second (and only other) file allowed to import `stripe`.
- **New migration**: `alter type payment_method add value` for an online method (naming TBD — see
  §I question 1), plus whatever column(s) record the Stripe identifiers needed to reconcile a
  `payments` row back to a Stripe object (e.g. `stripe_payment_intent_id`, nullable, unique when
  present) and whatever new column `organizations` (or a new 1:1 table, following
  `org_subscriptions`'s and Phase B's own precedent of a dedicated table rather than widening an
  existing one) needs to store a connected-account id once an org completes Connect onboarding.
- **New RPC or a deliberate extension of `record_payment()`**: the online path still needs to end up
  as an audited row in `payments` with an allocation, but the *trigger* for creating that row is a
  webhook event, not an authenticated staff action — `record_payment()`'s current signature assumes
  a logged-in actor (`auth.uid()` recorded as `recorded_by`). A webhook-invoked path has no
  `auth.uid()` at all, so this likely needs a **second**, `service_role`-only RPC (e.g.
  `record_online_payment()`) rather than reusing `record_payment()` unchanged — a real design
  decision, not a detail (§I question 2).
- **New webhook route**, structurally parallel to `app/api/webhooks/stripe/route.ts` but listening
  for payment/Connect events (`payment_intent.succeeded`, `payment_intent.payment_failed`, and
  whatever Connect account events matter for onboarding status) rather than subscription events —
  likely a distinct URL path (e.g. `app/api/webhooks/stripe-connect/route.ts`) so the two Stripe
  webhook endpoint secrets stay independently rotatable, matching the "structurally separate
  integration" conclusion above.
- **New flag** (`PERMITFIELD_FF_QUOTES_PAYMENTS_ONLINE`, per §1) gating the new module, the new
  webhook route, the new RPC's callable surface, and the "Pay now" UI affordance all together — the
  same "checked before anything else runs" discipline `isClientPortalEnabled()` follows.
- **New entitlement** (`payments.online`, per §1) added to `lib/billing/tiers.ts`'s `Entitlement`
  union and to whichever tier(s) the owner decides should include it.

This is a plan sketch for review, not implementation — consistent with `GATE_4_PHASE_B_FINDINGS.md`'s
own framing of its equivalent section, and with this document's stated purpose of settling §I's
questions before any migration is written.

---

## §I. Blocking questions (genuine business/security decisions — Phase C cannot start without these)

1. **New enum value naming and scope.** Is Phase C exactly one new `payment_method` value (e.g.
   `'card'` or `'stripe_online'`), or does the owner want to distinguish payment *methods* Stripe
   itself supports (card, Interac via Stripe, etc.) as separate enum values from day one? This
   changes both the migration and the UI's payment-history rendering
   (`app/invoice/[token]/page.tsx`'s existing `p.method === 'e_transfer' ? 'E-transfer' : 'Cheque'`
   ternary would need to become a real lookup either way).

   **Recommendation: one new value, named `'card'`, not `'stripe_online'`.**
   - Stripe already tracks the fine-grained method (card vs. Interac vs. pre-auth debit) on its own
     side, per-charge (`payment_intent.charges.data[0].payment_method_details.type`) — that
     granularity is retrievable from Stripe directly for reconciliation if ever needed, so this
     repo's own enum doesn't have to carry it too.
   - `e_transfer`/`cheque` name the *payment mechanism*, not the processor — `'card'` stays
     consistent with that register; `'stripe_online'` leaks an implementation detail into a value
     that, per the risk already noted, can never be removed once added (only ever grown). If Stripe
     were ever swapped for another PSP later, `'card'` still reads correctly; `'stripe_online'`
     would not.
   - Enums are a one-way door — narrower-now-grow-later is the lower-risk direction than guessing a
     wider set upfront and being stuck with unused/mis-scoped values forever. If the owner
     specifically anticipates Interac-via-Stripe or pre-authorized debit soon, that's a second
     additive migration later, not a blocker to shipping `'card'` now.
2. **Who calls the new write path, and with what identity.** Confirmed above that a webhook-invoked
   payment has no `auth.uid()`. Does the owner want (a) a `service_role`-only RPC invoked directly by
   the webhook handler, (b) the webhook handler writing directly via a service-role Supabase client
   without a new RPC at all (breaking the "RPC is the only write path" invariant Phase A established
   deliberately), or (c) some other shape? This is the single most consequential open question — it
   decides whether Phase C's payments RPC surface doubles or whether the existing invariant gets an
   explicit, documented exception.

   **Recommendation (not yet approved — for owner review): option (a), narrowly scoped.** Verified
   by reading `20260806000056_payments.sql` directly, not just inferring:
   - `record_payment()` cannot be reused unchanged, full stop — it calls `is_org_billing_manager()`,
     which checks `org_members.user_id = auth.uid()`. A webhook has no session; `auth.uid()` is
     `NULL`; no `org_members` row has a `NULL` `user_id`; the call fails `insufficient_privilege`
     every time. Not a style choice — a hard blocker.
   - The allocation-sum invariant ("allocations must sum exactly to the payment amount") is enforced
     only inside `record_payment()`'s own procedural body — no CHECK constraint or trigger backs it.
     A direct service-role write (option (b)) would need that check re-implemented in TypeScript,
     which is exactly the "second place for the two checks to silently drift apart" anti-pattern
     `lib/quotes-payments/payments.ts`'s own header comment already warns against for a *different*
     check — the same reasoning applies here.
   - `service_role` already holds raw `INSERT`/`UPDATE` grants on `payments` (and `INSERT` on
     `payment_allocations`) — nothing at the permissions layer stops option (b) today, which is
     exactly what flow A's own webhook does to `org_subscriptions` (a direct `.upsert()`, no RPC).
     But `org_subscriptions` is an explicitly-stated *mirror* table (single row per org, self-
     correcting on the next event) — `payments` is Phase A's deliberately-locked-down append-only
     ledger with a real cross-row arithmetic invariant. Copying flow A's direct-write pattern here
     would quietly undo that design decision, not just reuse a convenience.
   - Proposed shape: a new `record_online_payment()` RPC — same allocation-sum check duplicated *in
     SQL* (not TypeScript, so the invariant still lives in exactly one place per call path), no
     `is_org_billing_manager()` gate (there's no user to check), `revoke all ... from public; grant
     execute ... to service_role` **only** — deliberately never granted to `authenticated`, since
     `record_payment()`'s authenticated-reachability exists for real staff callers and this RPC's
     only legitimate caller is the webhook route. Authorization shifts from a role check to webhook
     signature verification being the entire authentication, mirroring flow A's own
     `stripe.webhooks.constructEvent()` posture exactly. `recorded_by` set to `NULL` explicitly (no
     user acted); a new nullable+unique `stripe_payment_intent_id` column carries the Stripe audit
     trail and doubles as the idempotency guard for Stripe's at-least-once redelivery (same
     discipline as flow A's `stripe_event_created_at` guard, shaped as insert-once-skip-on-retry
     rather than upsert, since payments are append-only and subscriptions are not).
3. **Entitlement granularity.** Confirmed `payments.manage` exists and gates manual recording today.
   Should online payment *acceptance* (a customer paying) be gated by a *different* entitlement than
   online payment *administration* (an org staff member viewing/reconciling online payments,
   onboarding Stripe Connect)? A customer paying an invoice isn't an org member at all — entitlement
   checks as currently designed (`can(orgId, entitlement)`) assume an authenticated org actor, not an
   anonymous token-holding customer. Does the "pay now" action even need an entitlement check, or
   only the org-side onboarding/administration surface?

   **Recommendation: split it, don't apply one entitlement to both surfaces.**
   - New `payments.online` entitlement (as §3.2 of `GATE_4_FINDINGS.md` already anticipated) gates
     only the *org-facing* administration surface — starting/managing Stripe Connect onboarding,
     toggling online payments on for the org — checked the same way `payments.manage` already gates
     `recordPayment()`, i.e. `can(orgId, 'payments.online')` from a real authenticated org actor.
   - The customer-facing "Pay now" click gets **no entitlement check at all** — `can()` assumes an
     org member, and a customer clicking a token link isn't one. Gating there is a flag check
     (`isQuotesPaymentsOnlineEnabled()`) plus a *data-level* precondition (the org has a connected
     Stripe account and has completed onboarding), not an entitlement lookup. Trying to force
     `can(orgId, entitlement)` onto an unauthenticated customer request would be reusing a function
     outside the actor-shape it was designed for, not a real access-control decision.
4. **Refund/reversal model.** Per §1: does a reversed online payment (a) call Stripe's refund API and
   then flip the `payments` row via a Stripe-aware wrapper around `reverse_payment()`, (b) require a
   brand-new `reverse_online_payment()` RPC that never touches `reverse_payment()` at all, or (c)
   something else? Whichever is chosen must still guarantee `payment_allocations` rows are never
   edited or deleted (Phase A's stated invariant), and that the ledger and Stripe's own record of the
   charge can't silently diverge.

   **Recommendation: option (a) — but note this is a different identity situation than question 2,
   not the same one.** Recording an online payment is webhook-triggered (no session, no
   `auth.uid()`) — that's what forced a new `record_online_payment()` RPC in question 2. *Reversing*
   one is different: a refund is naturally a **staff-initiated** action (a person decides to refund a
   customer), so a real `auth.uid()` session exists and `reverse_payment()`'s existing
   `is_org_billing_manager()` gate is exactly the right check to reuse, unchanged.
   - The new piece is only the step *before* the DB call: refunding money requires calling Stripe's
     refund API, which a Postgres RPC can't do (no outbound HTTP from `plpgsql`). So this is
     TypeScript orchestration in the new flow-B module, not a new RPC: (1) look up the payment's
     `stripe_payment_intent_id`, (2) call `stripe.refunds.create(...)`, (3) only on success, call the
     existing `reversePayment()` wrapper (which calls the existing, unmodified `reverse_payment()`
     RPC) to flip the ledger.
   - Sequencing matters: refund the money *first*, flip the ledger *second*. If the ledger flip then
     fails, that's a recoverable reconciliation gap (money already returned to the customer, ledger
     just needs a retry) — the safe direction of error, versus flipping the ledger first and having
     the Stripe call fail (ledger says reversed, customer never got their money back).
   - Add a `charge.refunded` handler to the new Phase C webhook as a defensive backstop, mirroring
     why flow A's webhook exists at all — covers a refund issued directly from the Stripe Dashboard
     rather than through this app, so the ledger doesn't silently drift from Stripe's own record.
5. **Connect account type and onboarding owner.** Stripe Connect offers Standard, Express, and
   Custom account types with materially different KYC/compliance burden on PermitField. Which does
   the owner want? Relatedly: who on the contractor's side completes onboarding — is there a new
   settings page (mirroring `app/(app)/settings/billing/page.tsx`'s existing pattern for flow A),
   gated by which role?

   **Recommendation: Standard accounts; onboarding gated by the existing `is_org_billing_manager()`
   tier.**
   - Standard: Stripe owns KYC/compliance/identity-verification and gives the contractor their own
     full Stripe Dashboard — least engineering lift, least new compliance surface for PermitField to
     own. Express would give PermitField tighter control over the onboarding UX at the cost of
     materially more integration work (Account Links, Express Dashboard); Custom pushes KYC/
     compliance/support burden onto PermitField entirely and is generally the wrong choice unless a
     fully white-labeled payment experience is a hard requirement. Nothing found in
     `GATE_4_FINDINGS.md` or the master prompt suggests that requirement exists.
   - This matches the pattern already visible across this codebase's own Stripe usage — inline
     `price_data` instead of Dashboard-configured Price IDs, no portal "plan switching" config — a
     consistent preference for the option that pushes the least configuration/compliance surface
     onto PermitField. Standard is the version of that same preference for Connect specifically, and
     is the right starting point for what the findings docs elsewhere call a "pilot."
   - Onboarding UI: reuse the existing `is_org_billing_manager()` role tier (owner/org_owner/
     platform_admin/permit_manager) — the same boundary `record_payment()`/`reverse_payment()` and
     `org_tax_profiles` already use as "who can take a consequential financial action for this org."
     No new role tier is needed or justified by anything found this pass.
6. **Platform fee.** Does PermitField take a cut of each online payment (Stripe Connect's
   `application_fee_amount`)? If yes, what basis (flat, percentage, tiered by plan) — this is a
   business/pricing decision this document cannot make, only surface as blocking.

   **Recommendation: defer — ship v1 at `application_fee_amount: 0`.** This is the owner's call to
   make, not a technical finding, but the lowest-scope-creep path for a first pass is to treat online
   payments as a value-add bundled into existing subscription tiers rather than a new revenue line on
   day one: it avoids building fee-calculation logic and PermitField-side fee reconciliation
   accounting before there's usage data to size the decision against, and a fee can be turned on
   later (an `application_fee_amount` on new Checkout Sessions going forward) without touching
   historical rows. Revisit once there's real usage to price against.
7. **Deposits on estimates, or invoices only?** `app/estimate/[token]/page.tsx` exists alongside the
   invoice token page — does Phase C's "pay now" apply only to issued invoices (the natural reading
   of "flow B: a contractor's customer paying online for contracted work"), or does the owner also
   want an online deposit-on-acceptance flow attached to estimates? These would likely be two
   separably-shippable pieces of Phase C rather than one, if both are wanted.

   **Recommendation: invoices only for this phase.** `payment_allocations.invoice_id` is the only
   allocation target that exists in the schema today — there is no estimate-allocation concept at
   all, so "deposit on an estimate" would need a new allocation target (a schema change, not just a
   new payment method) for a use case neither `GATE_4_FINDINGS.md` nor the master prompt actually
   requested; the invoice token page already computes `outstandingCents`, which estimates have no
   equivalent of (accepting an estimate isn't a monetary event in this schema). Keep deposits-on-
   estimates as an explicit candidate for a later phase rather than folding it into Phase C's scope.

---

## §9. Risks (found, not yet mitigated)

- **Enum migration is a one-way door.** Postgres does not support removing an enum value once added
  (`payment_method` already has two committed values with no removal path) — the naming decision in
  §I question 1 should be treated as effectively permanent.
- **Webhook identity gap (§I question 2) is a real security surface**, not just an API-design
  question: if the eventual implementation lets a webhook-reachable code path write to `payments`
  without going through an RPC that enforces the existing entitlement/flag checks, that becomes a
  second, easy-to-miss write path into a table the rest of this codebase treats as strictly
  RPC-gated. Whatever is decided needs the webhook signature-verification step to be the *sole*
  authentication for that path (as flow A's webhook already does), not an afterthought.
- **CAD-only constraint (§1) is currently enforced at the database level on both `invoices` and
  `payments`.** If Stripe Connect is ever used with a connected account whose settlement currency
  isn't CAD, the existing `check (currency_code = 'CAD')` constraint would reject the row outright
  — worth surfacing now so nobody discovers it mid-implementation as a mysterious insert failure.

---

This document does not request or assume approval to implement. Per `GATE_4_FINDINGS.md` line 19 and
the precedent `GATE_4_PHASE_B_FINDINGS.md` set for Phase B, Phase C implementation should not start
until the owner reviews §I above and responds with an explicit approval (e.g. `APPROVED: PHASE 4.C`,
or split sub-phase tokens if preferred).
