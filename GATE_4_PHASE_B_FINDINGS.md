# Gate 4 — Quotes & Payments — Phase B Findings (read-only)

Scope: `change_orders` and `credit_notes` — the two tables `GATE_4_FINDINGS.md`'s §7 plan sketch
named and explicitly deferred out of Phase A (see `supabase/migrations/20260806000049_payments.sql`'s
own header: "`credit_notes` is explicitly deferred to Phase B... not built here, not stubbed here,
genuinely out of scope for this pass"). **No code, schema, or migration has been written to produce
this report.** Per the master prompt's own rule ("Phase B and C each still require their own
report-and-approval step before starting," `GATE_4_FINDINGS.md` line 19) and this repo's precedent
for every other gate (`GATE_2_0_SPEC.md` written only after `GATE_2_0_FINDINGS.md` settled its own
open questions), this document exists to settle Phase B's open questions before any migration is
written, not after.

`APPROVED: PHASE 4.B` was received on this branch before this document existed. Treating that as
approval to *produce this report* (mirroring Phase 0's own precedent of an early, context-clear
approval), not as approval to *implement* — the token names a phase, and per §I below, "Phase B" is
not yet a single well-defined thing to approve. A second, informed `APPROVED: PHASE 4.B` (or
sub-phase tokens, e.g. `4.B.1`/`4.B.2`, if the owner wants to split it) is what would unblock
migrations, following this document's review.

---

## §1. What Phase A already built that Phase B must not duplicate or conflict with

- **`estimates`** (`20260806000045_estimates.sql`): mutable draft + append-only `estimate_revisions`
  jsonb snapshot per "send." `current_revision_id` points at the revision a customer-facing link
  renders and that `estimate_acceptances` validates against. Once `status` leaves `'draft'`, RLS
  stops matching direct client writes entirely — only `send_estimate()` (`SECURITY DEFINER`) can move
  it forward.
- **`invoices`** (`20260806000047_invoices.sql`): single, final invoice per the master prompt's
  "single final invoices" requirement — no invoice-revision concept exists (unlike estimates).
  `issued_line_items`/`issued_subtotal_cents`/`issued_discount_total_cents`/`issued_tax_total_cents`/
  `issued_total_cents` are a **jsonb + cents snapshot written once at issuance and never mutated
  again** — this is the load-bearing fact for §I question 1 below.
- **`payments` / `payment_allocations`** (`20260806000049_payments.sql`): append-only, correction-by-
  new-row-not-edit. A refund today = `reverse_payment()` flips the original row's `status` to
  `'reversed'`; the row's amount/method/date are never altered. The outstanding-balance calculation
  (`app/(app)/invoices/[id]/page.tsx` and `app/invoice/[token]/page.tsx`, both independently) is
  `issued_total_cents − Σ(payments where status = 'recorded')`. Neither page currently subtracts
  anything else — there is no third quantity in that formula today.
- **Client-portal tokens** (`client_access_tokens`, extended `20260816000001`): `target_kind` is a
  **bare text discriminator, not an enum**, specifically so a future `'change_order'` (or
  `'credit_note'`) target kind can be added by extending `resolveTargetToken()`'s TypeScript union
  alone — confirmed no migration is needed for this part.
- **Entitlements** (`lib/billing/tiers.ts`): one broad `invoices.manage`/`quotes.manage`/
  `payments.manage` per lifecycle, deliberately not one entitlement per RPC/table. Phase B tables
  should fold under whichever of these two existing entitlements they extend, not add a fourth.
- **Authorization actually enforced**: every Phase A RLS policy gates on `is_org_member(org_id)` —
  confirmed by reading the policies directly (`20260806000045_estimates.sql`,
  `20260806000047_invoices.sql`, `20260806000049_payments.sql`). `org_role` itself is only
  `('owner', 'member')` (`20260806000002_organizations_and_members.sql`) — there is no
  `permit_manager` or `billing_manager` role in the actual enum today, regardless of what any prior
  findings-doc prose implied.

---

## §I. Blocking questions (genuine business/security decisions — Phase B cannot start without these)

1. **Change order vs. an already-issued, immutable invoice.** Since `invoices.issued_total_cents`
   is a write-once snapshot, a change order arriving after issuance cannot alter it in place. Which
   model does Phase B implement?
   - (a) A change order can only attach to an estimate still in `'draft'`/`'sent'`/`'accepted'`
     status *before* an invoice is ever issued — it edits the working line items and, if the
     estimate was already `'accepted'`, forces a new customer acceptance of the changed scope
     before an invoice can be issued at all.
   - (b) A change order can attach *after* invoice issuance, and produces a **second, additional
     invoice** for the delta (reusing the existing single-final-invoice-per-something model, just
     scoped to the change order rather than the original estimate) — the original invoice's
     snapshot is never touched.
   - (c) A change order after issuance produces a **credit note or debit adjustment record**
     against the existing invoice's outstanding-balance calculation, without a second invoice.
   These are not compatible designs — (a) never needs `credit_notes` for change-order purposes at
   all; (b) and (c) need `invoices`/`credit_notes` to cross-reference a change order differently.
2. **Does a change order require client re-acceptance?** Estimates have a real
   accept/decline flow (`estimate_acceptances`, `AcceptEstimateForm`). If a change order can modify
   scope/price after the customer already accepted the original estimate, does the customer need to
   accept the change order too (a parallel acceptance flow + portal page), or is a change order
   purely an internal/staff record with no customer-facing action?
3. **What is a credit note, concretely, and how does it interact with the existing refund model?**
   `payments.sql`'s own comment already drew the line once ("a refund today is represented purely as
   a reversed payment row... a proper credit-note-against-an-invoice workflow is future work") —
   Phase B is that future work, but needs to say whether `credit_notes`:
   - replaces `reverse_payment()` as the refund mechanism going forward, or
   - is a distinct concept (e.g., reducing what's owed on a still-outstanding invoice, as opposed to
     returning money already paid) that coexists with payment reversal rather than superseding it.
   Whichever it is, the outstanding-balance formula in both invoice detail pages needs a matching,
   explicit update (currently `issued_total_cents − paid`, with no credit-note term) — this is a
   two-file change with real money-display consequences, not a detail to leave implicit.
4. **Does a credit note need its own sequential per-org numbering** (like `invoices.invoice_number`
   already has), for the same "a human-readable reference the customer can quote back" reason
   invoices have one? If yes, that's a `generate_next_invoice_number()`-shaped function to mirror,
   decided now rather than retrofitted.
5. **PDF and client-portal exposure.** Estimates and invoices each have a PDF route
   (`/api/public/{estimate,invoice}/[token]/pdf`) and a customer-facing portal page. Do change
   orders and/or credit notes get the same treatment (their own PDF + portal page), or are they
   staff-facing only for this phase, with any customer communication happening by email/PDF
   attachment through the existing invoice, not a dedicated new page? This determines whether Phase
   B needs new `app/{change-order,credit-note}/[token]/page.tsx` routes and new token `target_kind`
   values at all, or is schema/RPC/staff-UI only.
6. **Authorization**: fold under `invoices.manage` (if these are invoice-adjacent) or
   `quotes.manage` (if change orders are estimate-adjacent per answer to Q1), or split — a change
   order under `quotes.manage`, a credit note under `invoices.manage`/`payments.manage`? RLS itself
   will be `is_org_member(org_id)` either way per §1's finding (no role-per-action split exists in
   the actual `org_role` enum today) — this question is about which entitlement gates the
   feature-flagged UI, not about RLS.

---

## §2. Non-blocking implementation notes (informational, not decisions)

- Both new tables should follow the append-only-correction convention already used twice in this
  gate (`estimate_revisions`, `payments`) rather than introducing a third correction idiom.
- If Q1 resolves to (a) or (b), no new token `target_kind` is strictly required for a change order
  that never gets its own portal link — resolve Q5 before deciding this.
- Numbering (Q4), if needed, is additive to `organizations` or wherever `invoices.invoice_number`'s
  existing per-org sequence lives today — not investigated further here since it's contingent on
  Q1/Q3's answers.

---

Not self-issuing `APPROVED: PHASE 4.B` against this document's own conclusions — this document is
for review. Once §I is resolved (a short answer to each of the 6 questions is enough — full prose
sign-off not required), Phase B migration/RPC/UI work can begin under a fresh `APPROVED: PHASE 4.B`
reply.

---

## §III. Drafted answers to §I (pending confirmation, added 2026-09-13)

These are recommended defaults, drafted for the owner to confirm or edit — they are **not**
self-approving. A fresh `APPROVED: PHASE 4.B` (or sub-phase token) is still required against this
version of the document before any migration/RPC/UI work begins.

1. **Change order vs. immutable invoice — recommend a synthesis of (a) and (b), not a pure pick.**
   Pre-issuance, a change order is nothing more than editing the still-mutable estimate through the
   revision mechanism `estimate_revisions` already provides — no `change_orders` row is needed for
   that case at all, and if the estimate was already `'accepted'`, the change forces a new
   `estimate_acceptances` cycle before an invoice can ever be issued (this is just (a), and it's
   already buildable with zero new schema).
   The `change_orders` table earns its existence specifically for the **post-issuance** case: model
   (b) — a change order attaches after `invoices.issued_*` is frozen and produces a **second,
   additional invoice** for the delta, reusing the single-final-invoice-per-something model scoped to
   the change order. The original invoice's snapshot is never touched. (c) is rejected — folding
   change orders into the outstanding-balance formula conflates "more work was agreed to" with
   "money already invoiced was adjusted," which is what Q3/`credit_notes` is for instead.
2. **Re-acceptance — yes, required.** A change order that changes price/scope after the customer
   already accepted the original estimate needs its own acceptance, mirroring
   `estimate_acceptances`/`AcceptEstimateForm` (a parallel `change_order_acceptances` table + portal
   form). A change order is never purely an internal record if it changes what the customer owes —
   silently invoicing an amount the customer never agreed to is the failure mode to avoid.
3. **Credit notes — distinct concept, coexists with `reverse_payment()`, does not replace it.**
   `reverse_payment()` stays the mechanism for "money that was paid is being returned." A credit note
   is the opposite direction: it reduces what's owed on a still-outstanding invoice without any money
   having changed hands yet. Concretely: the outstanding-balance formula in both
   `app/(app)/invoices/[id]/page.tsx` and `app/invoice/[token]/page.tsx` becomes
   `issued_total_cents − Σ(payments where status = 'recorded') − Σ(credit_notes where status =
   'issued')` — a real, explicit third term, updated in both files together.
4. **Numbering — yes.** Credit notes get their own sequential per-org number, mirroring
   `generate_next_invoice_number()`'s existing shape (e.g. `generate_next_credit_note_number()`), for
   the same "human-readable reference the customer can quote back" reason invoices have one.
5. **PDF / portal exposure — split by artifact.** Change orders stay **staff-facing only** for this
   phase: per Q1's resolution, the only place a change order produces customer-visible money is the
   second invoice it generates, and that invoice already has a PDF route and portal page — no new
   `change-order` route or token `target_kind` is needed. Credit notes **do** get the same treatment
   invoices/estimates have (their own `/api/public/credit-note/[token]/pdf` + `app/credit-note/[token]/page.tsx`,
   and a new `'credit_note'` `target_kind` in `resolveTargetToken()`), because a credit note changes
   what the customer still owes and they need a citable, standalone record of that — not just an
   internal note or an email attachment.
6. **Authorization — both fold under `invoices.manage`, no split, no new entitlement.** Change
   orders only matter (per Q1) once they're producing a second invoice, which makes them
   invoice-adjacent rather than quote-adjacent despite the name; credit notes are invoice-adjacent by
   definition (Q3). RLS remains `is_org_member(org_id)` on both new tables either way, per §1's
   finding that no role-per-action split exists in the actual `org_role` enum today — this only
   decides which entitlement gates the feature-flagged UI.
