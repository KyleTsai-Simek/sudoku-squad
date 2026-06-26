'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthForm } from '@/components/auth-sheet';
import { useAuthStore } from '@/lib/auth-store';

export default function SignInPage() {
  const router = useRouter();
  const cancelEmailAuth = useAuthStore((s) => s.cancelEmailAuth);
  const [nextPath, setNextPath] = useState('/');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (next?.startsWith('/')) setNextPath(next);
  }, []);

  function goBack() {
    cancelEmailAuth();
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(nextPath);
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-4 text-foreground sm:px-6">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-md flex-col">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="justify-self-start text-sm font-medium text-muted hover:text-foreground"
          >
            ← Back
          </button>
          <h1 className="justify-self-center text-sm font-semibold text-foreground">Sign in</h1>
          <div aria-hidden="true" />
        </header>

        <section className="flex flex-1 flex-col justify-center py-10">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-normal text-foreground">
              Sign in
            </h2>
          </div>

          <AuthForm onComplete={() => router.push(nextPath)} />
        </section>
      </div>
    </main>
  );
}
