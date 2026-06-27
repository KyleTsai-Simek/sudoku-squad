'use client';

import { useState, type FormEvent } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { setUsername as setUsernameRemote } from '@/lib/username';
import { Modal } from './auth-sheet';

/**
 * Change-username modal for signed-in users ([DECISIONS #0043]). The server
 * appends a `#NNNN` discriminator if the chosen base is taken; we surface the
 * resulting full name back to the user.
 */
export function UsernameSheet({
  current,
  onClose,
}: {
  current: string | null;
  onClose: () => void;
}) {
  const applyUsername = useAuthStore((s) => s.applyUsername);
  // Prefill with the base (strip any existing #discriminator).
  const initialBase = (current ?? '').split('#')[0] ?? '';
  const [base, setBase] = useState(initialBase);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await setUsernameRemote(base.trim());
    setPending(false);
    if (res.ok) {
      applyUsername(res.username);
      setResult(res.username);
    } else {
      setError(res.error);
    }
  }

  return (
    <Modal title="Change username" onClose={onClose}>
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            You’re now <span className="font-medium text-foreground">{result}</span>.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={onSave} className="flex flex-col gap-3">
          <input
            type="text"
            autoCapitalize="off"
            spellCheck={false}
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="Your name"
            maxLength={20}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary-border focus:outline-none"
          />
          <p className="text-xs text-muted">3–20 characters.</p>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={pending || base.trim().length < 3}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </Modal>
  );
}
