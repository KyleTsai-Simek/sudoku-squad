'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Difficulty } from '@sudoku-squad/core';
import { getTierCounts, pickRandomUnsolved } from '@/lib/pick-puzzle';
import { getCompletionCount } from '@/lib/completions';
import { createRoom, joinRoom } from '@/lib/rooms';
import { getUsername, readCachedUsername } from '@/lib/username';
import { PublicLobbyList } from '@/components/public-lobby-list';

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
  const [loadingSolo, setLoadingSolo] = useState<Difficulty | null>(null);
  const [loadingBattle, setLoadingBattle] = useState<Difficulty | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinPending, setJoinPending] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
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

  async function startBattle(tier: Difficulty) {
    setLoadingBattle(tier);
    const username = await getUsername();
    const res = await createRoom({ mode: 'battle', difficulty: tier, username });
    setLoadingBattle(null);
    if (res.ok) {
      router.push(`/r/${res.value.room_code}`);
    } else {
      // Surface the error inline. For V1 we just alert; refine later.
      alert(`Could not start battle: ${res.error.message}`);
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    setJoinPending(true);
    setJoinError(null);
    const username = await getUsername();
    const res = await joinRoom({ code, username });
    setJoinPending(false);
    if (res.ok) {
      router.push(`/r/${res.value.room_code}`);
      return;
    }
    setJoinError(roomErrorMessage(res.error.code, res.error.message));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Sudoku Squad</h1>
        <p className="mt-3 text-base text-stone-600">
          Multiplayer sudoku — play together or race to the finish.
        </p>
        {username || completed !== null ? (
          <p className="mt-4 inline-flex items-center gap-3 rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs text-stone-600">
            {username ? (
              <span>
                <span className="text-stone-400">you’re</span>{' '}
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

      <section className="w-full">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
          Solo
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        </div>
      </section>

      <section className="w-full">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
          Battle a friend
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {(['easy', 'medium', 'hard'] as const).map((tier) => {
            const isLoading = loadingBattle === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => startBattle(tier)}
                disabled={isLoading}
                className="flex flex-col items-start gap-1 rounded-xl border border-amber-500 bg-white px-4 py-3 text-left hover:bg-amber-50 disabled:opacity-60"
              >
                <span className="text-xs font-medium uppercase tracking-widest text-amber-700">
                  {tier}
                </span>
                <span className="text-sm font-semibold text-stone-900">
                  {isLoading ? 'Creating…' : 'Start battle'}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Create a room and share the link — first to finish wins. Coop coming next.
        </p>
      </section>

      <PublicLobbyList />

      <section className="w-full">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
          Have a code?
        </h2>
        <form onSubmit={onJoin} className="flex gap-2">
          <input
            type="text"
            inputMode="text"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="6-char room code"
            maxLength={6}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono lowercase tracking-widest text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={joinPending || joinCode.trim().length === 0}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {joinPending ? 'Joining…' : 'Join'}
          </button>
        </form>
        {joinError ? (
          <p className="mt-2 text-xs text-red-600">{joinError}</p>
        ) : null}
      </section>

      <p className="text-xs text-stone-400">Phase 2 in progress · battle mode</p>
    </main>
  );
}

function roomErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'not_found':
      return "No room with that code. Double-check the URL.";
    case 'room_in_progress':
      return 'This battle has already started.';
    case 'room_finished':
      return 'This room is already over.';
    case 'room_full':
      return 'This room is full.';
    case 'unauthenticated':
      return "Couldn't sign in. Try refreshing.";
    case 'no_supabase':
      return 'Multiplayer is not available in this environment.';
    default:
      return fallback;
  }
}
