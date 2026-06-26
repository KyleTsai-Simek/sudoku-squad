'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { CloseIcon } from './material-icons';

/**
 * Sign-in flow ([DECISIONS #0043]). Email → 6-digit code. The same email also
 * carries a magic link (handled by /auth/callback) for people who'd rather tap
 * it. On success the visitor's anonymous progress is linked to (or merged into)
 * the account.
 */
export function AuthForm({ onComplete }: { onComplete: () => void }) {
  const startEmailAuth = useAuthStore((s) => s.startEmailAuth);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const cancelEmailAuth = useAuthStore((s) => s.cancelEmailAuth);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setWarning(null);
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
    setWarning(null);
    const res = await verifyCode(email.trim(), code.trim());
    setPending(false);
    if (res.ok) {
      if (res.warning) {
        setWarning(res.warning);
      } else {
        onComplete();
      }
    } else {
      setError(res.error ?? 'That code didn’t work. Check it and try again.');
    }
  }

  return (
    <>
      {step === 'email' ? (
        <form onSubmit={onSendCode} className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Sign in to save your progress across devices and pick your own username.
          </p>
          <label htmlFor="auth-email" className="sr-only">
            Email address
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            required
            enterKeyHint="send"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary-border focus:outline-none"
          />
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={pending || email.trim().length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : warning ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">You’re signed in.</p>
          <p className="text-xs text-foreground">{warning}</p>
          <button
            type="button"
            onClick={onComplete}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={onVerify} className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.
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
            className="rounded-lg border border-border bg-surface px-3 py-2 text-center text-lg font-mono tracking-[0.3em] text-foreground placeholder:tracking-normal placeholder:text-muted focus:border-primary-border focus:outline-none"
          />
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={pending || code.trim().length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
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
              setWarning(null);
            }}
            className="text-xs text-muted hover:text-foreground"
          >
            Use a different email
          </button>
        </form>
      )}
    </>
  );
}

export function AuthSheet({ onClose }: { onClose: () => void }) {
  const cancelEmailAuth = useAuthStore((s) => s.cancelEmailAuth);

  function close() {
    cancelEmailAuth();
    onClose();
  }

  return (
    <Modal onClose={close} title="Sign in">
      <AuthForm onComplete={onClose} />
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
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 px-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
