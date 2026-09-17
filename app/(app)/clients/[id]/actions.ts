'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOrgContext } from '@/lib/auth/org-context';

export interface EditClientState {
  error?: string;
  success?: boolean;
}

// Single-table update, RLS-gated by clients_update (is_org_member(org_id))
// -- same rationale as ./new/actions.ts's create action for why no separate
// lib/authz `can()` check exists here. The explicit .eq('org_id', orgId)
// alongside .eq('id', clientId) is redundant with RLS but kept anyway (see
// applications/page.tsx's header comment on this pattern) so a well-formed
// :id belonging to another org no-ops here rather than relying solely on
// RLS to have silently filtered it -- .update() with zero matched rows is
// not an error, so this reports success either way, matching what RLS would
// have done anyway (no cross-org write is possible either path).
export async function updateClientAction(
  _prevState: EditClientState,
  formData: FormData
): Promise<EditClientState> {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();

  const clientId = String(formData.get('clientId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!clientId) {
    return { error: 'Missing client id.' };
  }
  if (!name) {
    return { error: 'Client name is required.' };
  }

  const { error: updateError } = await supabase
    .from('clients')
    .update({
      name,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
    })
    .eq('id', clientId)
    .eq('org_id', orgId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Server Component detail page reads this same row server-side -- without
  // this, the page would keep showing pre-edit values until an unrelated
  // navigation happened to remount it.
  revalidatePath(`/clients/${clientId}`);

  return { success: true };
}
