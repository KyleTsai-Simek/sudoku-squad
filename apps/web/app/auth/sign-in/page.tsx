'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-6 py-4">
      <AppHeader />

      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-foreground">Sudoku Squad</h1>
      </div>

      <section className="flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </button>

        <h2 className="text-2xl font-semibold tracking-normal text-foreground">Sign in</h2>

        <AuthForm onComplete={() => router.push(nextPath)} />
      </section>
    </main>
  );
}
