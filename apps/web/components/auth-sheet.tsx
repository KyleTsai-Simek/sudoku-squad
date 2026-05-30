'use client';

import { useState, type FormEvent } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { CloseIcon } from './material-icons';

/**
 * Sign-in modal ([DECISIONS #0043]). Email → 6-digit code. The same email also
 * carries a magic link (handled by /auth/callback) for people who'd rather tap
 * it. On success the visitor's anonymous progress is linked to (or merged into)
 * the account.
 */
export function AuthSheet({ onClose }: { onClose: () => void }) {
  const startEmailAuth = useAuthStore((s) => s.startEmailAuth);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const cancelEmailAuth = useAuthStore((s) => s.cancelEmailAuth);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await startEmailAuth(email.trim());
    setPending(false);
    if (res.ok) {
      setStep('code');
    } else {
      setError(res.error ?? 'Could not send the code. Try again.');
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await verifyCode(email.trim(), code.trim());
    setPending(false);
    if (res.ok) {
      onClose();
    } else {
      setError(res.error ?? 'That code didn’t work. Check it and try again.');
    }
  }

  function close() {
    cancelEmailAuth();
    onClose();
  }

  return (
    <Modal onClose={close} title={step === 'email' ? 'Sign in' : 'Enter your code'}>
      {step === 'email' ? (
        <form onSubmit={onSendCode} className="flex flex-col gap-3">
          <p className="text-sm text-stone-600">
            Sign in to save your progress across devices and pick your own username.
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={pending || email.trim().length === 0}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="flex flex-col gap-3">
          <p className="text-sm text-stone-600">
            We sent a 6-digit code to <span className="font-medium text-stone-900">{email}</span>.
            Enter it below, or tap the link in the email.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            maxLength={6}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-center text-lg font-mono tracking-[0.3em] text-stone-900 placeholder:tracking-normal placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={pending || code.trim().length === 0}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {pending ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelEmailAuth();
              setStep('email');
              setCode('');
              setError(null);
            }}
            className="text-xs text-stone-500 hover:text-stone-800"
          >
            Use a different email
          </button>
        </form>
      )}
    </Modal>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
