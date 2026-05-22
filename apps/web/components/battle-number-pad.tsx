'use client';

import {
  selectBattleCanRedo,
  selectBattleCanUndo,
  useBattleStore,
} from '@/lib/battle-store';
import type { CellValue } from '@sudoku-squad/core';
import { PencilIcon } from './pencil-icon';
import { EraserIcon, RedoIcon, UndoIcon } from './action-icons';

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const BTN =
  'flex h-12 items-center justify-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 transition-colors active:translate-y-px disabled:opacity-40 hover:bg-stone-50';

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
          aria-label={notesMode ? 'Turn notes mode off (Space)' : 'Turn notes mode on (Space)'}
          title="Notes mode (Space)"
          className={cn(
            'flex h-12 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors active:translate-y-px disabled:opacity-40',
            notesMode
              ? 'border-amber-500 bg-amber-500 text-white shadow-sm hover:bg-amber-600'
              : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-50',
          )}
        >
          <PencilIcon filled={notesMode} />
          Notes
        </button>
        <button
          type="button"
          onClick={clearCell}
          disabled={disabled}
          className={BTN}
          aria-label="Clear cell"
        >
          <EraserIcon />
          Clear
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={disabled || !canUndo}
          className={BTN}
          aria-label="Undo"
        >
          <UndoIcon />
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={disabled || !canRedo}
          className={BTN}
          aria-label="Redo"
        >
          <RedoIcon />
          Redo
        </button>
      </div>
    </div>
  );
}
