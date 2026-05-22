'use client';

import {
  selectBattleCanRedo,
  selectBattleCanUndo,
  useBattleStore,
} from '@/lib/battle-store';
import type { CellValue } from '@sudoku-squad/core';

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const BTN =
  'flex h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 transition-colors active:translate-y-px disabled:opacity-40 hover:bg-stone-50';

/**
 * Number pad for battle mode. Same UI as the SP NumberPad minus the Hint
 * button (multiplayer hint is a server endpoint that hasn't landed yet —
 * see TODO Phase 2 backend).
 */
export function BattleNumberPad() {
  const enterValue = useBattleStore((s) => s.enterValue);
  const clearCell = useBattleStore((s) => s.clearCell);
  const undo = useBattleStore((s) => s.undo);
  const redo = useBattleStore((s) => s.redo);
  const notesMode = useBattleStore((s) => s.notesMode);
  const toggleNotesMode = useBattleStore((s) => s.toggleNotesMode);
  const canUndo = useBattleStore(selectBattleCanUndo);
  const canRedo = useBattleStore(selectBattleCanRedo);
  const finishedAt = useBattleStore((s) => s.finishedAt);
  const disabled = finishedAt !== null;

  return (
    <div className="flex w-full max-w-[min(92vw,560px)] flex-col gap-2">
      <div className="grid grid-cols-9 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => enterValue(n as CellValue)}
            className={cn(BTN, 'h-14 text-xl font-semibold')}
            aria-label={`Enter ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={toggleNotesMode}
          disabled={disabled}
          aria-pressed={notesMode}
          className={cn(BTN, notesMode && 'border-amber-500 bg-amber-100 text-amber-900')}
        >
          Notes {notesMode ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={clearCell}
          disabled={disabled}
          className={BTN}
          aria-label="Clear cell"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={disabled || !canUndo}
          className={BTN}
          aria-label="Undo"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={disabled || !canRedo}
          className={BTN}
          aria-label="Redo"
        >
          Redo
        </button>
      </div>
    </div>
  );
}
