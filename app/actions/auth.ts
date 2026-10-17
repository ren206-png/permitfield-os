'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// scope 'local': signs out this browser only. Supabase's default ('global')
// ended the session on every device, so signing out on a phone also signed
// the person out on their office computer.
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
