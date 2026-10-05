import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// submitFilingByEmail() for an attachments-only authority (Surrey), against an
// in-memory stand-in for the Supabase client. sendEmail and the audit log are
// mocked: nothing leaves the process.

const sendEmail = vi.fn();
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock('@/lib/audit/log', () => ({ writeAuditLog: vi.fn(async () => ({ ok: true })) }));

const { submitFilingByEmail } = await import('./submit');

const APP = '40000000-0000-0000-0000-00000000000a';
const FILING = '00000000-0000-0000-0004-000000000004';
const pdf = (body: string) => new Blob([`%PDF-1.7\n${body}`]);

interface Fixture {
  documents: { original_filename: string; storage_path: string; status: string }[];
  files: Record<string, Blob>;
  inserted: Record<string, unknown>[];
}

// Every query chain resolves to the row(s) its table holds; filters are
// accepted and ignored because each table has exactly one relevant row here.
function fakeClient(fixture: Fixture): SupabaseClient {
  const rows: Record<string, unknown> = {
    permit_applications: {
      id: APP,
      status: 'documents_generated',
      permit_status: 'ready_to_submit',
      project_address: '13450 104 Ave, Surrey, BC',
      permit_type_id: 'pt',
      contractors: { company_name: 'Acme Electric' },
    },
    permit_type_filings: {
      id: FILING,
      permit_type_id: 'pt',
      permit_types: { title: 'Commercial Tenant Improvement' },
      authorities: {
        id: 'surrey',
        name: 'City of Surrey - Building Division',
        filing_mechanism: 'pdf_email',
        submission_email: 'permitapplication@surrey.ca',
        submission_attachments_only: true,
        submission_payment_method_required: true,
      },
    },
    generated_documents: { id: 'gen-1', storage_path: 'gen/form.pdf' },
    org_tax_profiles: { invoice_contact_email: 'office@acme.example' },
  };
  const chain = (table: string) => {
    const result = table === 'application_documents' ? { data: fixture.documents, error: null } : { data: rows[table] ?? null, error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => result;
    q.single = async () => result;
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    q.update = () => q;
    q.insert = async (row: Record<string, unknown>) => {
      fixture.inserted.push({ table, ...row });
      return { error: null };
    };
    return q;
  };
  return {
    from: chain,
    rpc: async (name: string) => ({ data: name === 'can_submit_filings' ? true : null, error: null }),
    storage: {
      from: () => ({
        download: async (path: string) => (fixture.files[path] ? { data: fixture.files[path], error: null } : { data: null, error: { message: 'not found' } }),
        createSignedUrls: async () => {
          throw new Error('attachments-only authorities must not get links');
        },
      }),
    },
  } as unknown as SupabaseClient;
}

const ctx = { orgId: 'org', orgName: 'Acme Electric Inc.', userId: 'user', userEmail: 'owner@acme.example', role: 'owner' as const };

describe('submitFilingByEmail() for an attachments-only authority', () => {
  beforeEach(() => {
    vi.stubEnv('PERMITFIELD_FF_CITY_SUBMISSION', 'true');
    vi.stubEnv('PERMITFIELD_FF_READINESS', 'true');
    vi.stubEnv('PERMITFIELD_SUBMISSION_EMAIL_OVERRIDE', 'submission-test@example.test');
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ success: true, id: 'msg-1' });
  });
  afterEach(() => vi.unstubAllEnvs());

  const fixture = (documents: Fixture['documents'], files: Record<string, Blob>): Fixture => ({
    documents,
    files: { 'gen/form.pdf': pdf('form'), ...files },
    inserted: [],
  });

  it('attaches the form and every document as separate PDFs, with the method of payment, and no links', async () => {
    const f = fixture(
      [
        { original_filename: 'Site plan.pdf', storage_path: 'u/site.pdf', status: 'pending' },
        { original_filename: 'Old plan.pdf', storage_path: 'u/old.pdf', status: 'rejected' },
      ],
      { 'u/site.pdf': pdf('site') }
    );
    const result = await submitFilingByEmail(fakeClient(f), ctx, APP, FILING, { paymentMethod: 'Credit card by phone' });

    expect(result.ok).toBe(true);
    const email = sendEmail.mock.calls[0][0];
    expect(email.to).toBe('submission-test@example.test');
    expect(email.subject).toBe('13450 104 Ave, Surrey, BC, Commercial Tenant Improvement');
    expect(email.attachments.map((a: { filename: string }) => a.filename)).toEqual([
      '13450 104 Ave, Surrey, BC Application Form.pdf',
      'Site plan.pdf',
    ]);
    expect(email.text).toContain('Method of payment: Credit card by phone');
    expect(email.text).toContain('Also attached:\n- Site plan.pdf');
    expect(email.text).not.toMatch(/https?:\/\//);
    expect(f.inserted.find((r) => r.table === 'filing_submissions')).toMatchObject({ status: 'sent', document_links_expire_at: null });
  });

  it('refuses without a method of payment, before sending anything', async () => {
    const result = await submitFilingByEmail(fakeClient(fixture([], {})), ctx, APP, FILING, { paymentMethod: '   ' });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/asks for the method of payment/) });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a non-PDF document, naming it, before sending anything', async () => {
    const f = fixture([{ original_filename: 'Storefront photo.jpg', storage_path: 'u/photo.jpg', status: 'pending' }], {
      'u/photo.jpg': new Blob([new Uint8Array([0xff, 0xd8, 0xff])]),
    });
    const result = await submitFilingByEmail(fakeClient(f), ctx, APP, FILING, { paymentMethod: 'Cheque' });
    expect(result).toEqual({ ok: false, error: 'City of Surrey - Building Division only accepts PDF attachments. Replace or remove: Storefront photo.jpg.' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
