'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MFA_CODE_PATTERN } from '@/lib/auth/mfa';
import { createClient } from '@/lib/supabase/client';

// Runs against Supabase Auth directly from the browser (the MFA API is a
// per-user, session-scoped client API): list, set up (enroll + verify the
// first code), and remove an authenticator app.

interface Factor {
  id: string;
  friendly_name?: string;
  status: string;
  created_at: string;
}

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

const input = 'rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900';
const primaryButton =
  'rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60';

export function TwoFactorSettings() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const { data, error: listError } = await createClient().auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      return;
    }
    setFactors(data.totp.filter((f) => f.status === 'verified'));
  }, []);

  useEffect(() => {
    // Clear half-finished set-ups left behind by an abandoned attempt, then load.
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      for (const factor of data?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      await load();
    })();
  }, [load]);

  async function startEnrollment() {
    setError(null);
    setMessage(null);
    setPending(true);
    const { data, error: enrollError } = await createClient().auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator ${new Date().toLocaleDateString('en-CA')}`,
    });
    setPending(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? 'Could not start the set-up.');
      return;
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    if (!MFA_CODE_PATTERN.test(code)) {
      setError('Enter the 6-digit code from the app.');
      return;
    }
    setError(null);
    setPending(true);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code });
    setPending(false);
    if (verifyError) {
      setError('That code didn’t work. Check the app shows PermitField and enter the current code.');
      return;
    }
    setEnrollment(null);
    setCode('');
    setMessage('Two-factor sign-in is on. You’ll be asked for a code each time you sign in.');
    await load();
  }

  async function cancelEnrollment() {
    if (enrollment) await createClient().auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setCode('');
    setError(null);
  }

  async function removeFactor(factorId: string) {
    if (!window.confirm('Turn off two-factor sign-in? Your account will be protected by your password only.')) return;
    setError(null);
    setMessage(null);
    setPending(true);
    const { error: unenrollError } = await createClient().auth.mfa.unenroll({ factorId });
    setPending(false);
    if (unenrollError) {
      setError(unenrollError.message);
      return;
    }
    setMessage('Two-factor sign-in is off.');
    await load();
  }

  if (factors === null) {
    return <p className="text-sm text-zinc-500">{error ?? 'Loading…'}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-900">Two-factor sign-in</h2>

      {factors.length > 0 ? (
        <>
          <p className="text-sm text-emerald-700">On. You enter a code from your authenticator app each time you sign in.</p>
          {factors.map((factor) => (
            <div key={factor.id} className="flex items-center justify-between text-sm text-zinc-700">
              <span>
                {factor.friendly_name ?? 'Authenticator app'} · added {new Date(factor.created_at).toLocaleDateString('en-CA')}
              </span>
              <button type="button" onClick={() => void removeFactor(factor.id)} disabled={pending} className="text-xs font-medium text-red-600 underline underline-offset-2">
                Turn off
              </button>
            </div>
          ))}
        </>
      ) : enrollment ? (
        <form onSubmit={confirmEnrollment} className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR code as an SVG data URL */}
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" className="h-44 w-44 self-center" />
          <p className="text-xs text-zinc-500">
            Can&apos;t scan? Enter this key instead: <span className="break-all font-mono text-zinc-800">{enrollment.secret}</span>
          </p>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            2. Enter the 6-digit code it shows
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              className={`${input} tracking-[0.3em]`}
            />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? 'Checking…' : 'Turn on'}
            </button>
            <button type="button" onClick={() => void cancelEnrollment()} className="text-sm text-zinc-600 underline underline-offset-2">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm text-zinc-600">Off. Add an authenticator app so a stolen password alone can&apos;t get into your account.</p>
          <button type="button" onClick={() => void startEnrollment()} disabled={pending} className={`${primaryButton} self-start`}>
            Set up an authenticator app
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
    </div>
  );
}
