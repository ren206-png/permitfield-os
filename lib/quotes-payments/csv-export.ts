// Gate 4 (Quotes & Payments), Phase A -- CSV export for issued invoices and
// recorded/reversed payments, scoped to an org + a received/issued date
// range. No CSV library exists in package.json (checked before writing this
// file), so escaping is hand-rolled here rather than pulling in a new
// dependency for one module.
//
// Scope decision (flagged, since the master prompt only said "a CSV export
// module... for issued invoices (and/or payments)" without picking one):
// this file exports BOTH `exportInvoicesCsv()` (issued invoices only --
// drafts and voided invoices are excluded, since a draft has no
// issued_total_cents/invoice_number yet and a voided invoice's original
// issued snapshot is still a real historical financial event worth
// including... but see the note on voided rows below) and
// `exportPaymentsCsv()` (all payments in range, both `recorded` and
// `reversed`, with status as its own column so a reconciling accountant can
// filter/exclude reversed rows themselves rather than this module silently
// hiding them). Both are small, single-purpose, table-scoped queries rather
// than one "everything" export, matching this gate's existing
// one-concern-per-function style (estimates.ts/invoices.ts/payments.ts each
// export narrow, single-purpose functions rather than one do-everything
// entry point).
//
// Voided invoices ARE included in exportInvoicesCsv() output (with their
// status column reading "void") rather than filtered out entirely: an
// issued-then-voided invoice's issued_total_cents is still real financial
// history (the migration's own header comment: "no cascading delete of
// issued financial history"), and silently dropping it from an export an
// org might use for bookkeeping would misstate what was actually issued.
// Only true drafts (never issued, so no issued_total_cents to report) are
// excluded.
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCents } from './db-mapping';
import type { QPClient } from './types';

/**
 * Hand-rolled RFC 4180-style CSV field escaping: wraps a field in double
 * quotes and doubles any embedded double quote whenever the field contains
 * a comma, a double quote, or any line-break character (CR or LF) --
 * exactly the three cases RFC 4180 requires quoting for. A field needing no
 * escaping is returned verbatim (no unnecessary quoting), matching the
 * "plain unless it must be quoted" convention most spreadsheet tools expect
 * on read-back.
 */
export function csvEscapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvEscapeField).join(',');
}

export function buildCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [csvRow(header), ...rows.map((row) => csvRow(row))];
  // CRLF line endings, matching RFC 4180's canonical CSV line terminator
  // (many spreadsheet tools tolerate bare \n, but \r\n is the spec-correct
  // choice and costs nothing extra here).
  return lines.join('\r\n') + '\r\n';
}

export interface InvoiceCsvExportParams {
  orgId: string;
  /** Inclusive lower bound, compared against `issued_at` (date-only, 'YYYY-MM-DD'). */
  fromDate: string;
  /** Inclusive upper bound, compared against `issued_at` (date-only, 'YYYY-MM-DD'). */
  toDate: string;
}

const INVOICE_CSV_HEADER = [
  'invoice_number',
  'status',
  'client_id',
  'project_id',
  'issued_at',
  'due_date',
  'currency_code',
  'subtotal_cents',
  'discount_total_cents',
  'tax_total_cents',
  'total_cents',
  'subtotal',
  'discount_total',
  'tax_total',
  'total',
  'document_hash',
] as const;

/**
 * Exports issued (and voided-after-issuance) invoices for `orgId` whose
 * `issued_at` falls within [`fromDate`, `toDate`] (both inclusive, compared
 * as dates -- `issued_at` is a timestamptz column, so the range filter uses
 * `>= fromDate 00:00:00` and `< toDate + 1 day` semantics via Postgres's own
 * date-comparison casting, not a client-side date-math reimplementation).
 * Both a raw-cents column and a formatted-dollars column are included per
 * money field -- the raw cents column is the authoritative value for anyone
 * re-importing this CSV programmatically, the dollars column
 * (`centsToDollarsString()`, never toFixed/Intl.NumberFormat, per this
 * codebase's money discipline) is for a human opening the file directly.
 */
export async function exportInvoicesCsv(supabase: QPClient, params: InvoiceCsvExportParams): Promise<string> {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      'invoice_number, status, client_id, project_id, issued_at, due_date, currency_code, issued_subtotal_cents, issued_discount_total_cents, issued_tax_total_cents, issued_total_cents, document_hash'
    )
    .eq('org_id', params.orgId)
    .not('issued_at', 'is', null)
    .gte('issued_at', params.fromDate)
    .lt('issued_at', nextDay(params.toDate))
    .order('issued_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load invoices for CSV export (org ${params.orgId}): ${error.message}`);
  }

  const rows = (data ?? []).map((row) => {
    const subtotalCents = dbValueToCents(row.issued_subtotal_cents);
    const discountTotalCents = dbValueToCents(row.issued_discount_total_cents);
    const taxTotalCents = dbValueToCents(row.issued_tax_total_cents);
    const totalCents = dbValueToCents(row.issued_total_cents);
    return [
      String(row.invoice_number ?? ''),
      String(row.status ?? ''),
      String(row.client_id ?? ''),
      String(row.project_id ?? ''),
      String(row.issued_at ?? ''),
      String(row.due_date ?? ''),
      String(row.currency_code ?? ''),
      subtotalCents.toString(),
      discountTotalCents.toString(),
      taxTotalCents.toString(),
      totalCents.toString(),
      centsToDollarsString(subtotalCents),
      centsToDollarsString(discountTotalCents),
      centsToDollarsString(taxTotalCents),
      centsToDollarsString(totalCents),
      String(row.document_hash ?? ''),
    ];
  });

  return buildCsv(INVOICE_CSV_HEADER, rows);
}

export interface PaymentCsvExportParams {
  orgId: string;
  /** Inclusive lower bound, compared against `received_at` (date-only, 'YYYY-MM-DD'). */
  fromDate: string;
  /** Inclusive upper bound, compared against `received_at` (date-only, 'YYYY-MM-DD'). */
  toDate: string;
}

const PAYMENT_CSV_HEADER = [
  'method',
  'status',
  'client_id',
  'received_at',
  'currency_code',
  'amount_cents',
  'amount',
  'reference_note',
  'reversal_reason',
] as const;

/** Exports payments (both `recorded` and `reversed`, see this file's header comment) for `orgId` whose `received_at` falls within [`fromDate`, `toDate`] (both inclusive; `received_at` is a plain `date` column, so this is a direct string comparison, no day-boundary arithmetic needed the way `exportInvoicesCsv()`'s timestamptz filter requires). */
export async function exportPaymentsCsv(supabase: QPClient, params: PaymentCsvExportParams): Promise<string> {
  const { data, error } = await supabase
    .from('payments')
    .select('method, status, client_id, received_at, currency_code, amount_cents, reference_note, reversal_reason')
    .eq('org_id', params.orgId)
    .gte('received_at', params.fromDate)
    .lte('received_at', params.toDate)
    .order('received_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load payments for CSV export (org ${params.orgId}): ${error.message}`);
  }

  const rows = (data ?? []).map((row) => {
    const amountCents = dbValueToCents(row.amount_cents);
    return [
      String(row.method ?? ''),
      String(row.status ?? ''),
      String(row.client_id ?? ''),
      String(row.received_at ?? ''),
      String(row.currency_code ?? ''),
      amountCents.toString(),
      centsToDollarsString(amountCents),
      String(row.reference_note ?? ''),
      String(row.reversal_reason ?? ''),
    ];
  });

  return buildCsv(PAYMENT_CSV_HEADER, rows);
}

/** 'YYYY-MM-DD' -> the following day's 'YYYY-MM-DD', for turning an inclusive date upper bound into an exclusive `<` filter against a timestamptz column. Pure string/Date arithmetic, no timezone conversion beyond UTC-midnight parsing (dates here are already plain 'YYYY-MM-DD' calendar dates with no time-of-day component to preserve). */
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
