'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import type { Difficulty } from '@sudoku-squad/core';
import { getTierCounts, pickRandomUnsolved } from '@/lib/pick-puzzle';
import { getCompletionCount } from '@/lib/completions';
import { DIFFICULTY_LABEL, VISIBLE_DIFFICULTIES } from '@/lib/difficulty-labels';
import {
  DEFAULT_LEADERBOARD_LIMIT,
  getCompletionLeaderboard,
  type LeaderboardEntry,
} from '@/lib/leaderboard';
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
import {
  CalendarIcon,
  JoinIcon,
  PlayIcon,
  TrophyIcon,
  type IconProps,
} from '@/components/material-icons';
import { PublicLobbyList } from '@/components/public-lobby-list';

interface TierState {
  total: number;
  unsolved: number;
}

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
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null | undefined>(
    undefined,
  );
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
      const rows = await getCompletionLeaderboard();
      if (!cancelled) setLeaderboard(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, completed]);

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
  const dailyHeading = `${formatPacificMonthDay(dailyPuzzles?.[0]?.date)} Daily Puzzles`;
  const primaryDaily = DAILY_DIFFICULTIES.find((difficulty) => !dailyCompletions[difficulty]);
  const quickPlayPrimary = dailyPuzzles !== null && !primaryDaily;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-6 py-4">
      <AppHeader />
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-foreground">Sudoku Squad</h1>
      </div>

      {view.kind === 'home' && (
        <>
          <div className="flex w-full flex-col gap-2 pt-1">
            <SectionHeader icon={CalendarIcon} title={dailyHeading} />
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

          <div className="flex w-full flex-col gap-2 pt-1">
            <SectionHeader icon={PlayIcon} title="Quick Play" />
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
          <form onSubmit={onJoin} className="flex w-full flex-col gap-2 pt-1">
            <label
              htmlFor="join-code"
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted"
            >
              <JoinIcon size={16} className="shrink-0" />
              <span>Have a code?</span>
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

          <CompletionLeaderboard entries={leaderboard} />
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
          {VISIBLE_DIFFICULTIES.map((tier) => {
            const t = counts?.[tier];
            const total = t?.total ?? 0;
            const unsolved = t?.unsolved ?? 0;
            const empty = total === 0;
            const allDone = total > 0 && unsolved === 0;
            const isLoading = loadingSolo === tier;
            const label = DIFFICULTY_LABEL[tier];
            return (
              <button
                key={tier}
                type="button"
                onClick={() => startSolo(tier)}
                disabled={empty || isLoading}
                aria-label={
                  empty
                    ? `${label} puzzles coming soon`
                    : isLoading
                      ? `Picking ${label} puzzle`
                      : allDone
                        ? `Replay ${label} puzzle`
                        : `Start ${label} puzzle`
                }
                className={
                  empty
                    ? 'flex min-h-20 cursor-not-allowed items-center justify-center rounded-xl border border-dashed border-border px-3 py-3 text-center text-sm font-semibold uppercase tracking-widest text-muted'
                    : actionClassName({ primary: true, compact: true })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}

function CompletionLeaderboard({
  entries,
}: {
  entries: LeaderboardEntry[] | null | undefined;
}) {
  const currentUserRow = entries?.find((entry) => entry.isCurrentUser) ?? null;
  const currentUserIsOutsideTop =
    currentUserRow !== null && currentUserRow.rank > DEFAULT_LEADERBOARD_LIMIT;
  const pinCurrentUserFirst =
    currentUserRow !== null && (currentUserIsOutsideTop || currentUserRow.completedCount === 0);
  const topRows =
    entries?.filter(
      (entry) =>
        entry.rank <= DEFAULT_LEADERBOARD_LIMIT &&
        !(pinCurrentUserFirst && entry.isCurrentUser),
    ) ?? [];
  const displayedRows =
    entries && pinCurrentUserFirst && currentUserRow
      ? [currentUserRow, ...topRows]
      : entries
        ? topRows
        : null;

  return (
    <section className="flex w-full flex-col gap-3 pb-8 pt-1">
      <SectionHeader
        icon={TrophyIcon}
        title="Leaderboard"
        aside="Puzzles solved"
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {entries === undefined ? (
          <div className="px-4 py-5 text-sm text-muted">Loading leaderboard…</div>
        ) : entries === null ? (
          <div className="px-4 py-5 text-sm text-muted">
            Leaderboard is unavailable right now.
          </div>
        ) : displayedRows && displayedRows.length > 0 ? (
          <div className="divide-y divide-border">
            {displayedRows.map((entry) => (
              <LeaderboardRow key={entry.playerId} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-5 text-sm text-muted">
            No completed puzzles yet. Finish one to enter the board.
          </div>
        )}
      </div>
    </section>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  aside,
}: {
  icon: (props: IconProps) => ReactElement;
  title: string;
  aside?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-widest text-muted">
      <h2 className="inline-flex min-w-0 items-center gap-2">
        <Icon size={16} className="shrink-0" />
        <span className="truncate">{title}</span>
      </h2>
      {aside ? (
        <span className="shrink-0 text-right text-xs font-normal normal-case tracking-normal text-muted">
          {aside}
        </span>
      ) : null}
    </div>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div
      className={
        entry.isCurrentUser
          ? 'grid grid-cols-[3rem_1fr_auto] items-center gap-3 bg-primary-muted px-4 py-3 font-bold'
          : 'grid grid-cols-[3rem_1fr_auto] items-center gap-3 px-4 py-3'
      }
    >
      <span className={entry.isCurrentUser ? 'text-sm tabular-nums text-foreground' : 'text-sm font-semibold tabular-nums text-muted'}>
        #{entry.rank}
      </span>
      <span className="min-w-0 truncate text-sm text-foreground">
        {entry.username}
        {entry.isCurrentUser ? (
          <span className="ml-2 text-xs font-semibold text-muted">you</span>
        ) : null}
      </span>
      <span className="text-sm tabular-nums text-foreground">
        {entry.completedCount}
      </span>
    </div>
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
  const label = DIFFICULTY_LABEL[difficulty];
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

function formatPacificMonthDay(date?: string): string {
  const parsed = parsePacificDate(date);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(parsed);
}

function parsePacificDate(date?: string): Date {
  if (!date) return new Date();
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(Date.UTC(year, month - 1, day, 12));
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
