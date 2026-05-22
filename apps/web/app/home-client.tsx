'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Difficulty } from '@sudoku-squad/core';
import { getTierCounts, pickRandomUnsolved } from '@/lib/pick-puzzle';

interface TierState {
  total: number;
  unsolved: number;
}

const TIERS: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

const TIER_BLURB: Record<Difficulty, string> = {
  easy: 'Warm up.',
  medium: 'Standard.',
  hard: 'Real work.',
  expert: 'Bring tea.',
};

export function HomeClient() {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<Difficulty, TierState> | null>(null);
  const [loadingTier, setLoadingTier] = useState<Difficulty | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await getTierCounts();
      if (!cancelled) setCounts(c);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startNew(tier: Difficulty) {
    setLoadingTier(tier);
    const code = await pickRandomUnsolved(tier);
    setLoadingTier(null);
    if (code) router.push(`/play/${code}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Sudoku Squad</h1>
        <p className="mt-3 text-base text-stone-600">
          Multiplayer sudoku — play together or race to the finish.
        </p>
      </div>

      <section className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {TIERS.map((tier) => {
          const t = counts?.[tier];
          const total = t?.total ?? 0;
          const unsolved = t?.unsolved ?? 0;
          const empty = total === 0;
          const allDone = total > 0 && unsolved === 0;
          const isLoading = loadingTier === tier;

          return (
            <button
              key={tier}
              type="button"
              onClick={() => startNew(tier)}
              disabled={empty || isLoading}
              className={
                'group flex flex-col items-start gap-1 rounded-xl border px-5 py-4 text-left transition-colors ' +
                (empty
                  ? 'cursor-not-allowed border-dashed border-stone-300 text-stone-400'
                  : 'border-stone-900 bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60')
              }
            >
              <span className="text-xs font-medium uppercase tracking-widest">
                {tier}
              </span>
              <span className="text-lg font-semibold">
                {empty
                  ? 'Coming soon'
                  : isLoading
                    ? 'Picking…'
                    : allDone
                      ? `Replay (${total})`
                      : 'New game'}
              </span>
              <span
                className={
                  'text-xs ' +
                  (empty ? 'text-stone-400' : 'text-stone-300 group-hover:text-stone-200')
                }
              >
                {empty
                  ? '—'
                  : `${unsolved} unsolved · ${total} total · ${TIER_BLURB[tier]}`}
              </span>
            </button>
          );
        })}
      </section>

      <div className="flex w-full gap-3">
        <button
          type="button"
          disabled
          className="flex-1 cursor-not-allowed rounded-xl border border-dashed border-stone-300 px-5 py-4 text-center text-sm font-medium text-stone-400"
          title="Phase 2"
        >
          Battle (soon)
        </button>
        <button
          type="button"
          disabled
          className="flex-1 cursor-not-allowed rounded-xl border border-dashed border-stone-300 px-5 py-4 text-center text-sm font-medium text-stone-400"
          title="Phase 3"
        >
          Coop (soon)
        </button>
      </div>

      <p className="text-xs text-stone-400">Phase 1 in progress · single-player web</p>
    </main>
  );
}
