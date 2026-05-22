'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/lib/game-store';
import { pickRandomUnsolved } from '@/lib/pick-puzzle';

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s} seconds`;
  if (s === 0) return `${m} minute${m === 1 ? '' : 's'}`;
  return `${m}m ${s}s`;
}

export function CompletionOverlay() {
  const startedAt = useGameStore((s) => s.startedAt);
  const finishedAt = useGameStore((s) => s.finishedAt);
  const hintsUsed = useGameStore((s) => s.hintsUsed);
  const puzzle = useGameStore((s) => s.puzzle);
  const router = useRouter();
  const [loadingNext, setLoadingNext] = useState(false);

  if (finishedAt === null || startedAt === null) return null;
  const elapsed = finishedAt - startedAt;

  async function onPlayAnother() {
    if (!puzzle) return;
    setLoadingNext(true);
    const next = await pickRandomUnsolved(puzzle.difficulty);
    setLoadingNext(false);
    if (next) router.push(`/play/${next}`);
    else router.push('/');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Puzzle complete"
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/40 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <p className="text-sm font-medium uppercase tracking-widest text-amber-600">
          Solved
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Nicely done.</h2>
        <p className="mt-2 text-stone-600">
          {formatElapsed(elapsed)}
          {hintsUsed > 0 ? ` · ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}` : ''}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onPlayAnother}
            disabled={loadingNext}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {loadingNext ? 'Loading…' : `Play another ${puzzle?.difficulty ?? ''}`}
          </button>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}
