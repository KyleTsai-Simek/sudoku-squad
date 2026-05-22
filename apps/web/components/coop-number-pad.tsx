'use client';

import {
  selectCoopCanRedo,
  selectCoopCanUndo,
  useCoopStore,
} from '@/lib/coop-store';
import { cellValue as effectiveCellValue, digitCounts } from '@sudoku-squad/core';
import type { CellValue } from '@sudoku-squad/core';
import { PencilIcon } from './pencil-icon';
import { EraserIcon, RedoIcon, UndoIcon } from './action-icons';

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const BTN =
  'flex h-12 items-center justify-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 transition-colors active:translate-y-px disabled:opacity-40 hover:bg-stone-50';

/** See sudoku-board.tsx `digitButtonClasses` for the rationale. */
function digitButtonClasses(isSelectedDigit: boolean, isComplete: boolean): string {
  const base = 'flex h-14 items-center justify-center rounded-md border px-3 text-xl transition-colors active:translate-y-px disabled:opacity-40';
  const weight = isComplete ? 'font-light' : 'font-semibold';
  if (isComplete && isSelectedDigit) {
    return `${base} ${weight} border-emerald-500 bg-emerald-200 text-emerald-900`;
  }
  if (isComplete) {
    return `${base} ${weight} border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200`;
  }
  if (isSelectedDigit) {
    return `${base} ${weight} border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200`;
  }
  return `${base} ${weight} border-stone-300 bg-white text-stone-800 hover:bg-stone-50`;
}

/**
 * Number pad for battle mode. Same UI as the SP NumberPad minus the Hint
 * button (multiplayer hint is a server endpoint that hasn't landed yet —
 * see TODO Phase 2 backend).
 */
export function CoopNumberPad() {
  const enterValue = useCoopStore((s) => s.enterValue);
  const clearCell = useCoopStore((s) => s.clearCell);
  const undo = useCoopStore((s) => s.undo);
  const redo = useCoopStore((s) => s.redo);
  const notesMode = useCoopStore((s) => s.notesMode);
  const toggleNotesMode = useCoopStore((s) => s.toggleNotesMode);
  const canUndo = useCoopStore(selectCoopCanUndo);
  const canRedo = useCoopStore(selectCoopCanRedo);
  const finishedAt = useCoopStore((s) => s.finishedAt);
  const board = useCoopStore((s) => s.board);
  const selected = useCoopStore((s) => s.selected);
  const disabled = finishedAt !== null;

  const selectedDigit =
    board && selected !== null ? effectiveCellValue(board.cells[selected]!) : null;
  const counts = board ? digitCounts(board) : null;

  return (
    <div className="flex w-full max-w-[min(92vw,560px)] flex-col gap-2">
      <div className="grid grid-cols-9 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const isComplete = (counts?.get(n as CellValue) ?? 0) === 9;
          const isSelectedDigit = selectedDigit === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => enterValue(n as CellValue)}
              className={digitButtonClasses(isSelectedDigit, isComplete)}
              aria-label={`Enter ${n}${isComplete ? ' (complete)' : ''}`}
              aria-pressed={isSelectedDigit}
            >
              {n}
            </button>
          );
        })}
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
