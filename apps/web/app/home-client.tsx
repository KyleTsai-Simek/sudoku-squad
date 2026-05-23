'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Difficulty } from '@sudoku-squad/core';
import { getTierCounts, pickRandomUnsolved } from '@/lib/pick-puzzle';
import { getCompletionCount } from '@/lib/completions';
import { createRoom, type RoomMode } from '@/lib/rooms';
import { getUsername, readCachedUsername } from '@/lib/username';
import { PublicLobbyList } from '@/components/public-lobby-list';

interface TierState {
  total: number;
  unsolved: number;
}

/**
 * Visible tiers for the solo picker and the in-lobby host toggle. After the
 * 2026-05-22 rename (DECISIONS #0034), the bank shifted up by one and
 * `killer` is the hidden top tier (in DB but never surfaced in pickers).
 */
const TIERS: Difficulty[] = ['warmup', 'easy', 'medium', 'hard', 'expert'];

const TIER_LABEL: Record<Difficulty, string> = {
  warmup: 'Warm-up',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
  killer: 'Killer',
};

const TIER_BLURB: Record<Difficulty, string> = {
  warmup: 'Almost done already.',
  easy: 'Gentle introduction.',
  medium: 'A relaxed solve.',
  hard: 'Standard puzzle.',
  expert: 'Real work.',
  killer: '—',
};

/** Default difficulty when creating a multiplayer room — the host changes
 *  it from the lobby after creation. Centered in the visible range. */
const MP_DEFAULT_DIFFICULTY: Difficulty = 'medium';

type View = { kind: 'mode' } | { kind: 'sp' };

export function HomeClient() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'mode' });
  const [counts, setCounts] = useState<Record<Difficulty, TierState> | null>(null);
  const [loadingSolo, setLoadingSolo] = useState<Difficulty | null>(null);
  const [loadingMp, setLoadingMp] = useState<RoomMode | null>(null);
  const [completed, setCompleted] = useState<number | null>(null);
  const [username, setUsernameState] = useState<string | null>(() =>
    typeof window !== 'undefined' ? readCachedUsername() : null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, n, u] = await Promise.all([
        getTierCounts(),
        getCompletionCount(),
        getUsername(),
      ]);
      if (cancelled) return;
      setCounts(c);
      setCompleted(n);
      setUsernameState(u);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startSolo(tier: Difficulty) {
    setLoadingSolo(tier);
    const code = await pickRandomUnsolved(tier);
    setLoadingSolo(null);
    if (code) router.push(`/play/${code}`);
  }

  async function startMultiplayer(mode: RoomMode) {
    setLoadingMp(mode);
    const usernameValue = await getUsername();
    const res = await createRoom({
      mode,
      difficulty: MP_DEFAULT_DIFFICULTY,
      username: usernameValue,
    });
    setLoadingMp(null);
    if (res.ok) {
      router.push(`/r/${res.value.room_code}`);
    } else {
      alert(`Could not start ${mode}: ${res.error.message}`);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-6 py-10">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-stone-900">Sudoku Squad</h1>
        <p className="mt-2 text-sm text-stone-600">
          Multiplayer sudoku — play together or race to the finish.
        </p>
        {username || completed !== null ? (
          <p className="mt-4 inline-flex items-center gap-3 rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs text-stone-600">
            {username ? (
              <span>
                <span className="text-stone-400">you&apos;re</span>{' '}
                <span className="font-medium text-stone-900">{username}</span>
              </span>
            ) : null}
            {username && completed !== null ? <span className="text-stone-300">·</span> : null}
            {completed !== null ? (
              <span>
                <span className="font-medium text-stone-900">{completed}</span>{' '}
                <span className="text-stone-400">
                  puzzle{completed === 1 ? '' : 's'} solved
                </span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {view.kind === 'mode' && (
        <>
          <div className="flex w-full flex-col gap-3">
            <ModeButton
              label="Single-player"
              description="One puzzle, just you."
              onClick={() => setView({ kind: 'sp' })}
            />
            <ModeButton
              label="Co-op"
              description="Same board, solve together."
              loading={loadingMp === 'coop'}
              onClick={() => startMultiplayer('coop')}
            />
            <ModeButton
              label="Battle"
              description="Same puzzle, race to finish."
              loading={loadingMp === 'battle'}
              onClick={() => startMultiplayer('battle')}
            />
          </div>

          {/* Public lobbies render below the three mode cards when any
              exist. The component itself returns null on an empty list,
              so this section silently disappears when there's nothing
              open — no header, no placeholder. */}
          <PublicLobbyList />
        </>
      )}

      {view.kind === 'sp' && (
        <div className="flex w-full flex-col gap-3">
          <BackRow onBack={() => setView({ kind: 'mode' })} label="Single-player" />
          {TIERS.map((tier) => {
            const t = counts?.[tier];
            const total = t?.total ?? 0;
            const unsolved = t?.unsolved ?? 0;
            const empty = total === 0;
            const allDone = total > 0 && unsolved === 0;
            const isLoading = loadingSolo === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => startSolo(tier)}
                disabled={empty || isLoading}
                className={
                  'group flex flex-col items-start gap-1 rounded-xl border px-5 py-4 text-left transition-colors ' +
                  (empty
                    ? 'cursor-not-allowed border-dashed border-stone-300 text-stone-400'
                    : 'border-stone-900 bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60')
                }
              >
                <span className="text-xs font-medium uppercase tracking-widest">
                  {TIER_LABEL[tier]}
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
        </div>
      )}
    </main>
  );
}

function ModeButton({
  label,
  description,
  loading,
  onClick,
}: {
  label: string;
  description: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="group flex flex-col items-start gap-1 rounded-xl border border-stone-900 bg-stone-900 px-6 py-5 text-left text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
    >
      <span className="text-lg font-semibold">{loading ? 'Creating…' : label}</span>
      <span className="text-xs text-stone-300 group-hover:text-stone-200">{description}</span>
    </button>
  );
}

function BackRow({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
      >
        ←
      </button>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-500">{label}</h2>
    </div>
  );
}
