'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PuzzleCode } from '@sudoku-squad/core';
import { DIFFICULTY_LABEL } from '@/lib/difficulty-labels';
import {
  getDailyCompletions,
  getDailyPuzzles,
  type DailyCompletion,
  type DailyDifficulty,
  type DailyPuzzle,
} from '@/lib/daily-puzzles';
import { useAuthStore } from '@/lib/auth-store';

export const DAILY_DIFFICULTIES: DailyDifficulty[] = ['easy', 'medium', 'hard'];

export interface DailyCompletionOverride {
  date: string;
  difficulty: DailyDifficulty;
  code: PuzzleCode;
  solveTimeMs: number | null;
}

export interface DailyPuzzleState {
  puzzles: DailyPuzzle[] | null;
  completions: Partial<Record<DailyDifficulty, DailyCompletion>>;
}

export function useDailyPuzzleState(enabled = true): DailyPuzzleState {
  const [puzzles, setPuzzles] = useState<DailyPuzzle[] | null>(null);
  const [completions, setCompletions] = useState<
    Partial<Record<DailyDifficulty, DailyCompletion>>
  >({});
  const userId = useAuthStore((s) => s.userId);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const rows = await getDailyPuzzles();
      if (cancelled) return;
      setPuzzles(rows);
      const date = rows[0]?.date;
      if (!date) {
        setCompletions({});
        return;
      }
      const completionRows = await getDailyCompletions(date);
      if (cancelled) return;
      const byDifficulty: Partial<Record<DailyDifficulty, DailyCompletion>> = {};
      for (const completion of completionRows) {
        byDifficulty[completion.difficulty] = completion;
      }
      setCompletions(byDifficulty);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  return { puzzles, completions };
}

export function DailyPuzzleRow({
  state,
  completedOverride,
}: {
  state?: DailyPuzzleState;
  completedOverride?: DailyCompletionOverride;
}) {
  const loadedState = useDailyPuzzleState(state === undefined);
  const baseState = state ?? loadedState;
  const dailyByDifficulty = useMemo(
    () =>
      baseState.puzzles
        ? Object.fromEntries(
            baseState.puzzles.map((puzzle) => [puzzle.difficulty, puzzle]),
          ) as Partial<Record<DailyDifficulty, DailyPuzzle>>
        : {},
    [baseState.puzzles],
  );
  const completions = useMemo(() => {
    const next = { ...baseState.completions };
    if (completedOverride) {
      const puzzle = dailyByDifficulty[completedOverride.difficulty];
      if (!puzzle || puzzle.date === completedOverride.date) {
        next[completedOverride.difficulty] = {
          date: completedOverride.date,
          difficulty: completedOverride.difficulty,
          code: completedOverride.code,
          completedAt: new Date().toISOString(),
          solveTimeMs: completedOverride.solveTimeMs,
        };
      }
    }
    return next;
  }, [baseState.completions, completedOverride, dailyByDifficulty]);

  const solvedCount = DAILY_DIFFICULTIES.filter(
    (difficulty) => completions[difficulty],
  ).length;
  const primaryDaily = DAILY_DIFFICULTIES.find((difficulty) => !completions[difficulty]);

  return (
    <div className="grid w-full grid-cols-3 gap-2">
      {DAILY_DIFFICULTIES.map((difficulty) => (
        <DailyButton
          key={difficulty}
          difficulty={difficulty}
          puzzle={dailyByDifficulty[difficulty]}
          completion={completions[difficulty]}
          primary={primaryDaily === difficulty}
          solvedCount={solvedCount}
        />
      ))}
    </div>
  );
}

export function nextDailyDifficulty(
  state: DailyPuzzleState,
  completedOverride?: DailyCompletionOverride,
): DailyDifficulty | undefined {
  const completions = { ...state.completions };
  if (completedOverride) {
    completions[completedOverride.difficulty] = {
      date: completedOverride.date,
      difficulty: completedOverride.difficulty,
      code: completedOverride.code,
      completedAt: new Date().toISOString(),
      solveTimeMs: completedOverride.solveTimeMs,
    };
  }
  return DAILY_DIFFICULTIES.find((difficulty) => !completions[difficulty]);
}

function DailyButton({
  difficulty,
  puzzle,
  completion,
  primary,
  solvedCount,
}: {
  difficulty: DailyDifficulty;
  puzzle?: DailyPuzzle;
  completion?: DailyCompletion;
  primary: boolean;
  solvedCount: number;
}) {
  const href = puzzle
    ? `/play/${puzzle.code}?daily=${puzzle.date}&dailyDifficulty=${puzzle.difficulty}`
    : '/daily';
  const label = DIFFICULTY_LABEL[difficulty];
  const className = completion
    ? 'relative flex min-h-20 flex-col items-start justify-end gap-1 rounded-lg border border-success bg-success-soft px-3 py-3 text-left text-success-foreground transition-colors hover:bg-complete-strong'
    : actionClassName({ primary, compact: true });

  return (
    <a href={href} className={className}>
      {completion ? (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success text-[0.7rem] font-bold leading-none text-primary-foreground">
          ✓
        </span>
      ) : null}
      <span className={completion ? 'text-xs font-semibold uppercase tracking-widest' : 'text-sm font-semibold uppercase tracking-widest'}>
        {label}
      </span>
      {completion ? (
        <>
          <span className="min-h-[1rem] text-xs font-semibold">
            {solvedCount} solved
          </span>
          <span className="min-h-[1rem] text-xs font-medium">
            {formatDailyElapsed(completion.solveTimeMs)}
          </span>
        </>
      ) : null}
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
  const size = compact ? 'min-h-20 px-3 py-3' : 'px-6 py-5';
  const alignment = compact
    ? 'items-center justify-center text-center'
    : 'items-start text-left';
  const layout = `group flex flex-col gap-1 rounded-xl border transition-colors disabled:opacity-60 ${alignment} ${size}`;
  if (primary) {
    return `${layout} border-primary bg-primary text-primary-foreground hover:bg-primary-hover`;
  }
  return `${layout} border-primary-border bg-primary-muted text-foreground hover:bg-primary-soft`;
}

function formatDailyElapsed(ms: number | null): string {
  if (ms === null) return 'Solved today';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s today`;
  return `${minutes}:${String(seconds).padStart(2, '0')} today`;
}

export function formatPacificMonthDay(date?: string): string {
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
