'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Magic-link landing page ([DECISIONS #0043]). Supabase redirects here with a
 * PKCE `?code=...` after the user taps the link in their email. We exchange it
 * for a session, finish any pending progress-merge, then send them home. The
 * primary sign-in UX is the in-app numeric code (no redirect); this route is
 * the fallback for people who click the link instead.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const completeMagicLink = useAuthStore((s) => s.completeMagicLink);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await completeMagicLink();
      if (cancelled) return;
      if (res.ok) {
        router.replace('/');
      } else {
        setError(res.error ?? 'Could not finish signing in.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [completeMagicLink, router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => router.replace('/')}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Back to home
          </button>
        </>
      ) : (
        <p className="text-sm text-stone-600">Signing you in…</p>
      )}
    </main>
  );
}
