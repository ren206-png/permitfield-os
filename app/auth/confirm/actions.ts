'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recoveryTokenHash } from '@/lib/auth/recovery';

// Spends the reset link's one-time token and signs the person in, then sends
// them to choose a new password. Runs only when they press Continue on
// /auth/confirm, never on the link's GET: email security scanners open links
// automatically, and a GET that spent the token would leave the customer a
// dead link.
export async function confirmRecoveryAction(formData: FormData): Promise<void> {
  const tokenHash = recoveryTokenHash({ token_hash: formData.get('token_hash'), type: formData.get('type') });
  if (!tokenHash) redirect('/login?error=reset_link');

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
  if (error) {
    console.error(`auth/confirm: recovery verification failed: ${error.message}`);
    redirect('/login?error=reset_link');
  }
  redirect('/reset-password');
}
