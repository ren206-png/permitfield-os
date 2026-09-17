'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';

export interface NewClientState {
  error?: string;
}

// Single-table insert -- no multi-step transaction to worry about (contrast
// app/(app)/projects/new/actions.ts's create_project_with_intake RPC, which
// needs to be atomic because it writes client+property+project together).
// RLS's clients_insert policy (is_org_member(org_id)) is the only
// authorization check this needs; no separate lib/authz `can()` gate exists
// for clients the way it does for projects (that module's own header
// comment scopes it to specific resources, and clients isn't one of them
// yet), so this mirrors contractors/new/actions.ts's shape instead.
export async function createClientAction(
  _prevState: NewClientState,
  formData: FormData
): Promise<NewClientState> {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!name) {
    return { error: 'Client name is required.' };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('clients')
    .insert({
      org_id: orgId,
      name,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
    })
    .select('id')
    .single();

  if (insertError) {
    return { error: insertError.message };
  }

  redirect(`/clients/${inserted.id}`);
}
