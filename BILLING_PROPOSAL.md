# Billing/subscription proposal

Status: **ratified, build in progress.** Written in response to `PHASE_0_FINDINGS.md`
§H/§I#2's open conflict ("no existing subscription system in this codebase to reuse...
needs clarification") — this is the clarification, worked out via research rather than
left unresolved indefinitely. §1's per-organization/volume-tiered model direction and
§3's Stripe architecture were accepted as proposed. §2's original four-tier draft
(Starter/Professional/Business/Enterprise) was replaced with a decisive two-tier +
Enterprise recommendation, which Ren approved ("yes") — that revision is reflected
below; the original four-tier numbers are no longer current. Building against Stripe
**test mode** now; switching to live keys/going live-priced remains a deliberate,
separate step per §3/§4.

## 1. Why per-organization, not per-seat

Two viable axes exist: charge per user (seat), or charge per organization with a usage
tier (volume). This codebase's own data model already leans toward the second, and
building the first would mean adding infrastructure that doesn't exist today:

- `org_members` has **no seat cap anywhere** — `org_members_insert`'s RLS policy only
  checks `is_org_owner(org_id)`, nothing limits headcount. Per-seat billing needs a seat
  limit enforced somewhere (RLS, RPC, or app layer) that would have to be built from
  scratch.
- `lib/entitlements/index.ts` **already has a volume-shaped limit key**:
  `'projects.active_max'`, currently hardcoded to `50` for every org via one
  `DEFAULT_TIER` constant. That module's own header comment says exactly this: a future
  real billing phase should replace the tier *lookup*, not any call site. Tiering by
  active-project-count is not a new concept here — it's the one axis this codebase
  already modeled and left hardcoded.
- Industry research backs this for the construction/permitting space specifically:
  volume/usage-based pricing (Procore-style, tied to project activity rather than seats)
  is the dominant model among larger construction platforms, and per-seat pricing
  "favors teams whose revenue grows faster than headcount" — the opposite of a
  contractor-facing tool where the unit of work is *projects*, not *people looking at
  a dashboard*. PermitFlow itself (closest direct comparable) bills a flat recurring
  subscription independent of seat count, with volume-tiered discounts.

Recommendation: **bill per organization, tiered by active-project limit + feature
gates**, unlimited seats within an org at every tier. This maps onto the entitlements
seam that already exists with the least new surface area.

## 2. Ratified tiers

Collapsed from the original four-tier draft above down to a decisive two self-serve
tiers + Enterprise, per Ren's "what is your recommendation" / "yes" — fewer tiers means
fewer Stripe Price objects to keep in sync and a simpler upgrade decision for a
contractor org sizing itself against active-project volume:

| Tier | Price | Active projects | Features |
|---|---|---|---|
| **Starter** | $149/mo | 10 | `projects.create`, `readiness.checker`. No override, no jurisdiction requirements, no analytics, no AI. |
| **Pro** | $499/mo | 50 | Everything: `projects.create`, `readiness.checker`, `readiness.override`, `jurisdiction.requirements`, `analytics`, `ai`. |
| **Enterprise** | Custom (talk to sales) | Unlimited | Everything, negotiated support/SLA. No self-serve Stripe Checkout — sales-assisted only. |

14-day free trial, no card required, defaulting to Pro-tier features during the trial
(matches the existing "14 days" convention already established for client-portal token
TTL — not load-bearing, just consistent with a number already picked once in this
codebase). After trial expiry with no card on file, org drops to a read-only state
(existing data visible, `projects.create` denied) rather than deleting anything — same
non-destructive posture as `NO_PLAN_TIER` in §3's entitlements design.

**What I'm not deciding for you:** the actual dollar amounts. These are placeholders
sized to "plausible for this market" from the research above, not a pricing study. Say
the word and I'll adjust before anything goes live-priced in Stripe.

## 3. Technical architecture

Stripe (Checkout + Customer Portal + webhooks) is the standard choice here — it's what
the current Next.js/Server-Actions architecture already fits without restructuring, and
"stand up your own PCI-scope payment handling" is explicitly a non-goal (this repo's own
"never enter payment credentials" discipline applies here too: nobody, including me,
should be touching raw card data — Stripe Checkout's hosted page is what keeps that true).

- **New table, main project** (`supabase/migrations/`): `org_subscriptions` —
  `org_id` (FK to `organizations`, unique), `stripe_customer_id`, `stripe_subscription_id`,
  `tier` (enum: `starter`/`pro`/`enterprise`), `status` (enum mirroring Stripe's:
  `trialing`/`active`/`past_due`/`canceled`), `current_period_end`, `trial_ends_at`. RLS:
  org members can `select` their own org's row; only `service_role` can write (mirrors
  `client_access_tokens`' own service-role-only-write pattern in the client-portal
  project). `create_organization_with_owner()` is extended to insert a trial row
  atomically alongside the org/owner insert, so no org ever exists without one.
- **Stripe is the source of truth**, this table is a synced mirror, never the other way
  around — no prices or plan logic duplicated into the DB, only the current
  tier/status/period-end needed for `can()`/`limit()` to read synchronously without an
  API call per request.
- **Checkout**: a Server Action on `/settings/billing` (owner-only) creates a Stripe
  Checkout Session (subscription mode, inline `price_data` rather than pre-created
  Stripe Price IDs — so nothing needs configuring in the Stripe Dashboard beyond an API
  key) for the Starter/Pro self-serve tiers, and redirects the org owner to Stripe's
  hosted page — same "redirect out, never collect card data ourselves" pattern as any
  Stripe-recommended integration. Enterprise has no Checkout flow (sales-assisted only,
  per §2).
- **Customer Portal**: a second Server Action creates a Stripe Billing Portal session
  scoped to payment-method update and cancellation only (not plan-switching, which
  would require pre-configuring Price IDs in the Stripe Dashboard's portal
  configuration) — upgrade/downgrade stays on the Checkout path above.
- **Webhook handler**: new Route Handler (`app/api/webhooks/stripe/route.ts`), verifies
  the Stripe signature against the raw request body (not parsed JSON — a common
  integration bug the research above specifically calls out), handles
  `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed` (logged, no dunning email
  yet — future work), upserts `org_subscriptions` accordingly. Idempotent by
  `stripe_subscription_id`/`org_id` — Stripe explicitly guarantees at-least-once
  delivery, not exactly-once. Gated by the new `PERMITFIELD_FF_BILLING` flag (404 when
  off), same discipline as every other route in `lib/flags.ts`.
- **`lib/entitlements/index.ts` change**: `can()`/`limit()` become async and, when
  `PERMITFIELD_FF_BILLING` is on, do a live `org_subscriptions` lookup by `orgId`
  (through a small pure `resolveEffectiveTier()` function, unit-tested without mocking
  Supabase) instead of the single hardcoded `DEFAULT_TIER` constant — every existing
  call site (`app/(app)/projects/new/actions.ts` today) keeps working with only an
  `await` added, exactly as that module's own header comment anticipated. When the flag
  is off, behavior is byte-identical to the legacy hardcoded tier — no environment is
  affected until the flag is explicitly turned on. An org with no `org_subscriptions`
  row, an expired trial, or a canceled subscription resolves to a zero-feature "no plan"
  tier rather than an error.
- **Import boundary**: only `lib/billing/subscriptions.ts` may import the `stripe`
  package or read `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, enforced by a new
  `stripeClientRestriction` ESLint rule mirroring the existing
  `clientPortalServiceClientRestriction`/`geminiClientRestriction` rules in
  `eslint.config.mjs`.
- **Env vars needed from you**: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only —
  inline `price_data` on Checkout Sessions means no Stripe Price IDs need creating in
  the Dashboard first. All of the above is being scaffolded against Stripe **test
  mode** without needing your live keys at all; switching to live keys/going
  live-priced is a deliberate, separate step you take when ready.

## 4. Status and what's still needed from you

Items 1–3 below are ratified (model direction, §2 numbers, 14-day no-card trial) and
the build is underway against Stripe test mode per §3.

4. **A Stripe account** (test mode is enough to start) — I cannot create one for you;
   sign-up and API key retrieval is exactly the kind of "create an account / enter
   credentials" action reserved for you to do yourself. Once you have `STRIPE_SECRET_KEY`
   and `STRIPE_WEBHOOK_SECRET` (the latter from `stripe listen` or a configured
   webhook endpoint in the Dashboard), set them plus `PERMITFIELD_FF_BILLING=true` in
   your environment to turn this on — everything ships default-OFF and byte-identical
   to today's behavior until you do.

The architecture in §3 is standard Stripe-subscriptions-on-Next.js — migration,
entitlements refactor, three new routes, one settings page, no further research
needed.

## Sources consulted

- [SaaS Stripe Integration: Billing Made Simple (2026)](https://designrevision.com/blog/saas-stripe-integration)
- [Stripe for Next.js: Complete Integration Guide (Webhooks, Subscriptions, Payments)](https://designrevision.com/blog/stripe-nextjs)
- [How to Build a SaaS Billing System: Complete Guide (2026)](https://designrevision.com/blog/saas-billing-system)
- [How to Build a Stripe Customer Portal in Next.js SaaS](https://dev.to/kosta_official/how-to-build-a-stripe-customer-portal-in-nextjs-saas-1b0n)
- [5 Best PermitFlow Alternatives for Permit Expediting (2026)](https://permitplace.com/alternatives/permitflow-alternatives/)
- [PermitFlow Software Pricing, Alternatives & More 2026 | Capterra](https://www.capterra.com/p/10013903/PermitFlow/)
- [2026 Construction Management Software Pricing Guide: 7 Platforms Compared](https://softcircles.com/blog/construction-management-software-pricing-guide-2026)
- [SaaS Pricing for Construction Companies (2026) — 280 Tools Compared | PulseSignal](https://getpulsesignal.com/for/construction)
