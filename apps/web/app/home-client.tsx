'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Difficulty } from '@sudoku-squad/core';
import { getTierCounts, pickRandomUnsolved } from '@/lib/pick-puzzle';
import { getCompletionCount } from '@/lib/completions';
import {
  getDailyCompletions,
  getDailyPuzzles,
  type DailyCompletion,
  type DailyDifficulty,
  type DailyPuzzle,
} from '@/lib/daily-puzzles';
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
 * Visible tiers for the solo picker and the in-lobby host toggle. `killer`
 * is the hidden top tier (in DB but never surfaced in pickers).
 */
const TIERS: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'extreme'];

const TIER_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
  extreme: 'Extreme',
  killer: 'Killer',
};

const TIER_BLURB: Record<Difficulty, string> = {
  easy: 'Almost done already.',
  medium: 'Gentle introduction.',
  hard: 'A relaxed solve.',
  expert: 'Standard puzzle.',
  extreme: 'Real work.',
  killer: '—',
};

/** Default difficulty when creating a multiplayer room — the host changes
 *  it from the lobby after creation. Keeps the old default puzzle strength
 *  after the label shift. */
const MP_DEFAULT_DIFFICULTY: Difficulty = 'hard';

const DAILY_DIFFICULTIES: DailyDifficulty[] = ['easy', 'medium', 'hard'];

type View = { kind: 'home' } | { kind: 'quickplay' } | { kind: 'sp' };

export function HomeClient() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'home' });
  const [counts, setCounts] = useState<Record<Difficulty, TierState> | null>(null);
  const [loadingSolo, setLoadingSolo] = useState<Difficulty | null>(null);
  const [loadingMp, setLoadingMp] = useState<RoomMode | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinPending, setJoinPending] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<number | null>(null);
  const [dailyPuzzles, setDailyPuzzles] = useState<DailyPuzzle[] | null>(null);
  const [dailyCompletions, setDailyCompletions] = useState<
    Partial<Record<DailyDifficulty, DailyCompletion>>
  >({});
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const puzzles = await getDailyPuzzles();
      if (cancelled) return;
      setDailyPuzzles(puzzles);
      const date = puzzles[0]?.date;
      if (!date) {
        setDailyCompletions({});
        return;
      }
      const completions = await getDailyCompletions(date);
      if (cancelled) return;
      const byDifficulty: Partial<Record<DailyDifficulty, DailyCompletion>> = {};
      for (const completion of completions) {
        byDifficulty[completion.difficulty] = completion;
      }
      setDailyCompletions(byDifficulty);
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

  const dailyByDifficulty = dailyPuzzles
    ? Object.fromEntries(dailyPuzzles.map((puzzle) => [puzzle.difficulty, puzzle])) as
        Partial<Record<DailyDifficulty, DailyPuzzle>>
    : {};
  const primaryDaily = DAILY_DIFFICULTIES.find((difficulty) => !dailyCompletions[difficulty]);
  const quickPlayPrimary = dailyPuzzles !== null && !primaryDaily;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-6 py-4">
      <AppHeader />
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-foreground">Sudoku Squad</h1>
        <p className="mt-2 text-sm text-muted">
          Multiplayer sudoku — play together or race to the finish.
        </p>
        {username || completed !== null ? (
          <p className="mt-4 inline-flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-1.5 text-xs text-muted">
            {username ? (
              <span>
                <span className="text-muted">you&apos;re</span>{' '}
                <span className="font-medium text-foreground">{username}</span>
              </span>
            ) : null}
            {username && completed !== null ? <span className="text-muted">·</span> : null}
            {completed !== null ? (
              <span>
                <span className="font-medium text-foreground">{completed}</span>{' '}
                <span className="text-muted">
                  puzzle{completed === 1 ? '' : 's'} solved
                </span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {view.kind === 'home' && (
        <>
          <div className="flex w-full flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              Daily Puzzles
            </h2>
            <div className="grid w-full grid-cols-3 gap-2">
              {DAILY_DIFFICULTIES.map((difficulty) => {
                const puzzle = dailyByDifficulty[difficulty];
                const completion = dailyCompletions[difficulty];
                return (
                  <DailyButton
                    key={difficulty}
                    difficulty={difficulty}
                    puzzle={puzzle}
                    completion={completion}
                    primary={primaryDaily === difficulty}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              Quick Play
            </h2>
            <button
              type="button"
              onClick={() => setView({ kind: 'quickplay' })}
              className={actionClassName({ primary: quickPlayPrimary })}
            >
              <span className="text-lg font-semibold">Start a game</span>
              <span className={quickPlayPrimary ? 'text-xs text-primary-foreground/75' : 'text-xs text-muted'}>
                Single-player, co-op, or battle.
              </span>
            </button>
          </div>

          {/* Compact join-by-code input. Sits below the primary home actions so
              shared-link recipients who only have a 6-char code can still get
              into a room without competing with the main CTA hierarchy. */}
          <form onSubmit={onJoin} className="flex w-full flex-col gap-2">
            <label
              htmlFor="join-code"
              className="text-xs font-semibold uppercase tracking-widest text-muted"
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
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono lowercase tracking-widest text-foreground placeholder:text-muted focus:border-primary-border focus:outline-none"
              />
              <button
                type="submit"
                disabled={joinPending || joinCode.trim().length === 0}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:border-primary-border hover:bg-surface-muted disabled:opacity-60"
              >
                {joinPending ? 'Joining…' : 'Join'}
              </button>
            </div>
            {joinError ? <p className="text-xs text-danger">{joinError}</p> : null}
          </form>

          <PublicLobbyList />
        </>
      )}

      {view.kind === 'quickplay' && (
        <div className="flex w-full flex-col gap-3">
          <BackRow onBack={() => setView({ kind: 'home' })} label="Start a game" />
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
      )}

      {view.kind === 'sp' && (
        <div className="flex w-full flex-col gap-3">
          <BackRow onBack={() => setView({ kind: 'quickplay' })} label="Single-player" />
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
                    ? 'cursor-not-allowed border-dashed border-border text-muted'
                    : 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-60')
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
                    (empty ? 'text-muted' : 'text-primary-foreground/70 group-hover:text-primary-foreground/80')
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
      className={actionClassName({ primary: false })}
    >
      <span className="text-lg font-semibold">{loading ? 'Creating…' : label}</span>
      <span className="text-xs text-muted">{description}</span>
    </button>
  );
}

function DailyButton({
  difficulty,
  puzzle,
  completion,
  primary,
}: {
  difficulty: DailyDifficulty;
  puzzle?: DailyPuzzle;
  completion?: DailyCompletion;
  primary: boolean;
}) {
  const href = puzzle
    ? `/play/${puzzle.code}?daily=${puzzle.date}&dailyDifficulty=${puzzle.difficulty}`
    : '/daily';
  const label = TIER_LABEL[difficulty];
  const content = (
    <>
      {completion ? (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success text-[0.7rem] font-bold leading-none text-primary-foreground">
          ✓
        </span>
      ) : null}
      <span className={completion ? 'text-xs font-semibold uppercase tracking-widest' : 'text-sm font-semibold uppercase tracking-widest'}>
        {label}
      </span>
      {completion ? (
        <span className="min-h-[1rem] text-xs font-medium">
          {formatElapsed(completion.solveTimeMs)}
        </span>
      ) : null}
    </>
  );
  const className = completion
    ? 'relative flex min-h-20 flex-col items-start justify-end gap-1 rounded-lg border border-success bg-success-soft px-3 py-3 text-left text-success-foreground transition-colors hover:bg-complete-strong'
    : actionClassName({ primary, compact: true });

  return (
    <a href={href} className={className}>
      {content}
    </a>
  );
}

function actionClassName({
  primary,
  compact = false,
}: {
  primary: boolean;
  compact?: boolean;
}): string {
  const size = compact
    ? 'min-h-20 px-3 py-3'
    : 'px-6 py-5';
  const alignment = compact
    ? 'items-center justify-center text-center'
    : 'items-start text-left';
  const layout = `group flex flex-col gap-1 rounded-xl border transition-colors disabled:opacity-60 ${alignment} ${size}`;
  if (primary) {
    return `${layout} border-primary bg-primary text-primary-foreground hover:bg-primary-hover`;
  }
  return `${layout} border-primary-border bg-primary-muted text-foreground hover:bg-primary-soft`;
}

function formatElapsed(ms: number | null): string {
  if (ms === null) return 'Solved';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function BackRow({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-muted"
      >
        ←
      </button>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</h2>
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
