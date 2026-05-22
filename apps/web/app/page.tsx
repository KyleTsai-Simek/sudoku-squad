import { Suspense } from 'react';
import { HomeClient } from './home-client';

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeClient />
    </Suspense>
  );
}

function HomeFallback() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Sudoku Squad</h1>
        <p className="mt-3 text-base text-stone-600">
          Multiplayer sudoku — play together or race to the finish.
        </p>
      </div>
      <p className="text-sm text-stone-400">Loading puzzles…</p>
    </main>
  );
}
