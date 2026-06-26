'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Difficulty } from '@sudoku-squad/core';
import { getTierCounts, pickRandomUnsolved } from '@/lib/pick-puzzle';
import { getCompletionCount } from '@/lib/completions';
import { createRoom, joinRoom, type RoomMode } from '@/lib/rooms';
import { getUsername } from '@/lib/username';
import { useAuthStore } from '@/lib/auth-store';
import { AppHeader } from '@/components/app-header';
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
  const [joinCode, setJoinCode] = useState('');
  const [joinPending, setJoinPending] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<number | null>(null);
  // Username display is owned by the auth store (kept fresh across sign-in /
  // rename / sign-out). The AppHeader boots the store; we just read it here.
  const username = useAuthStore((s) => s.username);
  // Re-read the solved count whenever the identity changes (e.g. a sign-in that
  // merged anonymous progress into an account changes the total).
  const userId = useAuthStore((s) => s.userId);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await getCompletionCount();
      if (!cancelled) setCompleted(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

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

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    setJoinPending(true);
    setJoinError(null);
    const usernameValue = await getUsername();
    const res = await joinRoom({ code, username: usernameValue });
    setJoinPending(false);
    if (res.ok) {
      router.push(`/r/${res.value.room_code}`);
      return;
    }
    setJoinError(roomErrorMessage(res.error.code, res.error.message));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-6 py-4">
      <AppHeader />
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
          <div className="flex w-full flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              Start a game
            </h2>
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
          </div>

          {/* Compact join-by-code input. Sits below the three primary
              CTAs so shared-link recipients who only have a 6-char code
              (no full URL) can still get into a room. */}
          <form onSubmit={onJoin} className="flex w-full flex-col gap-2">
            <label
              htmlFor="join-code"
              className="text-xs font-semibold uppercase tracking-widest text-stone-500"
            >
              Have a code?
            </label>
            <div className="flex gap-2">
              <input
                id="join-code"
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
            </div>
            {joinError ? <p className="text-xs text-red-600">{joinError}</p> : null}
          </form>

          {/* Public lobbies render below when any exist. The component
              itself returns null on an empty list, so this section
              silently disappears when there's nothing open. */}
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

function roomErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'not_found':
      return "Couldn't find a room with that code. Double-check it.";
    case 'room_full':
      return 'That room is full.';
    case 'room_over':
      return 'That room is already finished. Ask for a fresh link.';
    case 'mid_game_join_forbidden':
      return "That battle has already started — can't join mid-game.";
    default:
      return fallback;
  }
}
