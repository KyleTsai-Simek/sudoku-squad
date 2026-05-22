'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useGameStore } from '@/lib/game-store';
import { loadPuzzle } from '@/lib/puzzle-source';
import { SudokuBoard } from '@/components/sudoku-board';
import { NumberPad } from '@/components/number-pad';
import { KeyboardController } from '@/components/keyboard-controller';
import { Timer } from '@/components/timer';
import { SettingsSheet } from '@/components/settings-sheet';
import { CompletionOverlay } from '@/components/completion-overlay';
import {
  KeyboardShortcutsButton,
  KeyboardShortcutsOverlay,
} from '@/components/keyboard-shortcuts-overlay';

type Status = 'loading' | 'ready' | 'not-found';

export function PlayClient({ code }: { code: string }) {
  const board = useGameStore((s) => s.board);
  const puzzle = useGameStore((s) => s.puzzle);
  const startGame = useGameStore((s) => s.startGame);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;
    if (puzzle?.code === code && board) {
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
      startGame(p);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [code, puzzle?.code, board, startGame]);

  if (status === 'not-found') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <p className="text-sm uppercase tracking-widest text-stone-500">Not found</p>
        <h1 className="text-2xl font-semibold">No puzzle with that code.</h1>
        <p className="text-stone-600">
          Codes are six lowercase letters/digits. Double-check the URL, or pick a fresh one.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Back to menu
        </Link>
      </main>
    );
  }

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
        <div className="flex items-center gap-2">
          <span className="hidden text-xs uppercase tracking-widest text-stone-500 sm:inline">
            {puzzle?.difficulty ?? ''}
          </span>
          <KeyboardShortcutsButton />
          <SettingsSheet />
        </div>
      </header>

      {status === 'loading' ? (
        <div className="flex h-[60vh] items-center justify-center text-stone-500">Loading…</div>
      ) : (
        <>
          <SudokuBoard />
          <NumberPad />
          <KeyboardController />
          <KeyboardShortcutsOverlay />
          <CompletionOverlay />
        </>
      )}
    </main>
  );
}
