import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/org-context';
import { createClient } from '@/lib/supabase/server';
import { isQuotesPaymentsEnabled } from '@/lib/flags';
import { can } from '@/lib/entitlements';
import { centsToDollarsString } from '@/lib/money/cents';
import { dbValueToCentsOrNull } from '@/lib/quotes-payments/db-mapping';
import { InvoiceStatusBadge } from '@/components/invoice-status-badge';
import { LockedFeature } from '@/components/locked-feature';

// Same literal union components/invoice-status-badge.tsx already declares.
const INVOICE_STATUSES = ['draft', 'issued', 'void'] as const;
type InvoiceStatusFilter = (typeof INVOICE_STATUSES)[number];

function isKnownStatus(value: string): value is InvoiceStatusFilter {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

// Gate 4 (Quotes & Payments), Phase A. Mirrors
// app/(app)/estimates/page.tsx's shape exactly, same double gate, and the
// same search/filter addition -- see that file's header comment for why `q`
// resolves through a client-name lookup rather than an embedded-resource
// filter. This page's `q` is dual-purpose, unlike estimates': a purely
// numeric query (e.g. "42") is treated as an exact `invoice_number` match
// instead of a client-name search, since "find invoice #42" is a real,
// common lookup this list has no other way to satisfy (invoice_number isn't
// a free-text column `.ilike()` can partial-match against a bigint).
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  if (!isQuotesPaymentsEnabled()) {
    notFound();
  }

  const { orgId } = await requireOrgContext();
  const hasEntitlement = await can(orgId, 'invoices.manage');
  if (!hasEntitlement) {
    return (
      <LockedFeature
        title="Invoices unavailable"
        message="Your organization's plan does not include Quotes & Payments."
      />
    );
  }

  const { q, status } = await searchParams;
  const supabase = await createClient();

  const trimmedQuery = q?.trim();
  // Purely digits (optionally with surrounding whitespace, already
  // trimmed) -- an exact invoice_number match, not a substring search,
  // since invoice numbers are sequential and small; "42" should not also
  // match "142".
  const numericQuery = trimmedQuery && /^\d+$/.test(trimmedQuery) ? Number(trimmedQuery) : null;

  // Same null-vs-[] short-circuit contract as
  // app/(app)/estimates/page.tsx's matchingClientIds.
  let matchingClientIds: string[] | null = null;
  if (trimmedQuery && numericQuery === null) {
    const escaped = trimmedQuery.replace(/[%,]/g, '\\$&');
    const { data: matchingClients, error: clientsError } = await supabase
      .from('clients')
      .select('id')
      .eq('org_id', orgId)
      .ilike('name', `%${escaped}%`);
    if (clientsError) {
      throw new Error(`Failed to search clients: ${clientsError.message}`);
    }
    matchingClientIds = (matchingClients ?? []).map((c) => c.id);
  }

  // No generated database.types.ts exists in this repo (same reason every
  // status-badge component declares its own literal union instead of
  // importing one), so the Supabase client's inferred row shape is `any` --
  // annotated loosely here rather than hand-typed, to avoid this
  // intermediate variable's type silently drifting from whatever
  // `.select()` actually returns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invoices: any[] = [];

  if (matchingClientIds === null || matchingClientIds.length > 0) {
    let query = supabase
      .from('invoices')
      .select('id, status, currency_code, invoice_number, due_date, issued_total_cents, created_at, clients ( name )')
      .eq('org_id', orgId);

    if (status && isKnownStatus(status)) {
      query = query.eq('status', status);
    }
    if (numericQuery !== null) {
      query = query.eq('invoice_number', numericQuery);
    } else if (matchingClientIds !== null) {
      query = query.in('client_id', matchingClientIds);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw new Error(`Failed to load invoices: ${error.message}`);
    }
    invoices = data ?? [];
  }

  const hasActiveFilters = Boolean(trimmedQuery) || Boolean(status);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Invoices</h1>
        <div className="flex items-center gap-3">
          <a
            href={`/api/invoices/export?from=2000-01-01&to=${new Date().toISOString().slice(0, 10)}`}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            Export CSV
          </a>
          <Link
            href="/invoices/new"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            New invoice
          </Link>
        </div>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search client name or invoice #"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
        <select
          name="status"
          defaultValue={status && isKnownStatus(status) ? status : ''}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          Filter
        </button>
        {hasActiveFilters && (
          <Link href="/invoices" className="text-sm text-zinc-500 underline hover:text-zinc-900">
            Clear
          </Link>
        )}
      </form>

      {invoices.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {invoices.map((invoice) => {
            const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;
            const totalCents = dbValueToCentsOrNull(invoice.issued_total_cents);
            return (
              <li key={invoice.id}>
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-zinc-900">
                        {invoice.invoice_number !== null ? `Invoice #${invoice.invoice_number}` : 'Draft'} —{' '}
                        {client?.name ?? 'Unknown client'}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-500">{invoice.currency_code}</p>
                      {invoice.due_date && <p className="mt-1 text-sm text-zinc-600">Due {invoice.due_date}</p>}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <InvoiceStatusBadge status={invoice.status} />
                      {totalCents !== null && (
                        <p className="text-sm font-medium text-zinc-900">{centsToDollarsString(totalCents)}</p>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : hasActiveFilters ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No invoices match your search.</p>
          <Link href="/invoices" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">No invoices yet.</p>
          <Link href="/invoices/new" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
            Create your first invoice
          </Link>
        </div>
      )}
    </div>
  );
}
