// Gate 4 (Quotes & Payments), Phase A service layer -- shared types.
//
// `QPClient` mirrors lib/audit/log.ts's own `SupabaseClient<any>` shape
// exactly (that file's header comment explains why: no generated
// `database.types.ts` exists anywhere in this repo for any table, so every
// existing Supabase-client-typed helper in `lib/` already accepts the
// untyped generic client rather than inventing a parallel row-typing
// scheme for this one module). Every exported service function below
// accepts a caller-supplied client rather than constructing its own --
// callers pass either the session-scoped client from lib/supabase/server.ts
// (ordinary staff actions, RLS enforced) or a service-role client from
// lib/supabase/service-client.ts (the handful of RPCs that are
// service_role-only by the migration's own grant, e.g.
// record_estimate_acceptance -- see estimate-acceptances.ts's header
// comment for exactly where that boundary is drawn).
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QPClient = SupabaseClient<any>;

/** Draft-stage line item input shared by estimates and invoices (mirrors estimate_line_items/invoice_line_items column shapes). */
export interface LineItemDraftInput {
  description: string;
  /** Decimal string, matching the `numeric` column type -- never a `number` (lib/money/cents.ts's parseDecimalQuantity is the only parser). */
  quantity: string;
  unitPriceCents: bigint;
  /** Mutually exclusive with discountFixedCents -- matches the DB CHECK constraint; violating this throws inside lib/tax/engine.ts's calculateTax(). */
  discountPercent?: string | null;
  discountFixedCents?: bigint | null;
  position?: number;
}

/** One line item as stored/read back from estimate_line_items/invoice_line_items. */
export interface LineItemRecord {
  id: string;
  description: string;
  quantity: string;
  unitPriceCents: bigint;
  discountPercent: string | null;
  discountFixedCents: bigint | null;
  position: number;
}
