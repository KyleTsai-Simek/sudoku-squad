'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useGameStore } from '@/lib/game-store';
import { getSamplePuzzle } from '@/lib/sample-puzzles';
import { SudokuBoard } from '@/components/sudoku-board';
import { NumberPad } from '@/components/number-pad';
import { KeyboardController } from '@/components/keyboard-controller';
import { Timer } from '@/components/timer';
import { SettingsSheet } from '@/components/settings-sheet';
import { CompletionOverlay } from '@/components/completion-overlay';

export function PlayClient() {
  const params = useSearchParams();
  const seed = params.get('seed') ?? undefined;
  const board = useGameStore((s) => s.board);
  const startGame = useGameStore((s) => s.startGame);
  const puzzle = useGameStore((s) => s.puzzle);

  useEffect(() => {
    if (!board || (seed && puzzle?.id !== seed)) {
      startGame(getSamplePuzzle(seed));
    }
  }, [board, seed, puzzle?.id, startGame]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center gap-4 px-3 py-4">
      <header className="flex w-full items-center justify-between gap-3">
        <Link
          href="/"
          className="text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          ← Menu
        </Link>
        <Timer />
        <SettingsSheet />
      </header>

      <SudokuBoard />
      <NumberPad />
      <KeyboardController />
      <CompletionOverlay />
    </main>
  );
}
