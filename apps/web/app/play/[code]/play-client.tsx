'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useGameStore } from '@/lib/game-store';
import { loadPuzzle } from '@/lib/puzzle-source';
import { installSpAutosave, resumeSavedGame } from '@/lib/sp-persistence';
import { SudokuBoard } from '@/components/sudoku-board';
import { NumberPad } from '@/components/number-pad';
import { KeyboardController } from '@/components/keyboard-controller';
import { AppHeader } from '@/components/app-header';
import { Timer } from '@/components/timer';
import { SettingsSheet } from '@/components/settings-sheet';
import { CompletionOverlay } from '@/components/completion-overlay';
import { SinglePlayerPauseOverlay } from '@/components/single-player-pause-overlay';
import {
  KeyboardShortcutsButton,
  KeyboardShortcutsOverlay,
} from '@/components/keyboard-shortcuts-overlay';
import { difficultyLabel } from '@/lib/difficulty-labels';

type Status = 'loading' | 'ready' | 'not-found';

function dailyDifficultyOrNull(value: string | undefined): 'easy' | 'medium' | 'hard' | null {
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : null;
}

export function PlayClient({
  code,
  dailyDate,
  dailyDifficulty,
}: {
  code: string;
  dailyDate?: string;
  dailyDifficulty?: string;
}) {
  const board = useGameStore((s) => s.board);
  const puzzle = useGameStore((s) => s.puzzle);
  const startGame = useGameStore((s) => s.startGame);
  const [status, setStatus] = useState<Status>('loading');
  const dailyDifficultyValue = dailyDifficultyOrNull(dailyDifficulty);

  // Install autosave once so an in-progress game survives a refresh/crash.
  useEffect(() => installSpAutosave(), []);

  useEffect(() => {
    let cancelled = false;
    const daily =
      dailyDate && dailyDifficultyValue
        ? { date: dailyDate, difficulty: dailyDifficultyValue }
        : null;
    if (puzzle?.code === code && board) {
      setStatus('ready');
      return;
    }
    // Auto-resume a persisted in-progress game for this code before fetching.
    // It's self-contained (givens + solution), so this also works offline.
    if (resumeSavedGame(code, { daily: daily?.difficulty ? daily : null })) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    (async () => {
      const p = await loadPuzzle(code);
      if (cancelled) return;
      if (!p) {
        setStatus('not-found');
        return;
      }
      startGame(
        daily?.difficulty
          ? { ...p, daily: { date: daily.date, difficulty: daily.difficulty } }
          : p,
      );
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dailyDate, dailyDifficultyValue, puzzle?.code, board, startGame]);

  if (status === 'not-found') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <p className="text-sm uppercase tracking-widest text-muted">Not found</p>
        <h1 className="text-2xl font-semibold">No puzzle with that code.</h1>
        <p className="text-muted">
          Codes are six lowercase letters/digits. Double-check the URL, or pick a fresh one.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Back to menu
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center gap-4 px-3 py-4">
      <AppHeader
        left={
          <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
            ← Menu
          </Link>
        }
        center={
          <span className="text-xs uppercase tracking-widest text-muted">
            {puzzle ? difficultyLabel(puzzle.difficulty) : ''}
            {puzzle?.daily ? ' daily' : ''}
          </span>
        }
        actions={
          <>
            <KeyboardShortcutsButton />
            <SettingsSheet />
          </>
        }
      />

      <Timer />

      {status === 'loading' ? (
        <div className="flex h-[60vh] items-center justify-center text-muted">Loading…</div>
      ) : (
        <>
          <SudokuBoard />
          <NumberPad />
          <KeyboardController />
          <KeyboardShortcutsOverlay />
          <SinglePlayerPauseOverlay />
          <CompletionOverlay />
        </>
      )}
    </main>
  );
}
