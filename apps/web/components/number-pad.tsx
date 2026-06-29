'use client';

import { selectCanRedo, selectCanUndo, useGameStore } from '@/lib/game-store';
import { cellValue as effectiveCellValue, digitCounts } from '@sudoku-squad/core';
import type { CellValue } from '@sudoku-squad/core';
import { PencilIcon } from './pencil-icon';
import { EraserIcon, RedoIcon, UndoIcon } from './action-icons';

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const BTN =
  'flex h-12 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors active:translate-y-px disabled:opacity-40 hover:bg-surface-muted';

/**
 * Classes for the 1-9 buttons depending on whether the digit is (a) the value
 * of the currently selected cell and (b) "complete" — all 9 placements done.
 * Both signals stack: completed-and-selected gets a deeper green than either
 * alone, and a completed digit's label drops to font-light. Conflict/non-final
 * states keep the default white treatment.
 */
function digitButtonClasses(isSelectedDigit: boolean, isComplete: boolean): string {
  const base = 'flex h-14 items-center justify-center rounded-md border px-3 text-xl transition-colors active:translate-y-px disabled:opacity-40';
  const weight = isComplete ? 'font-light' : 'font-semibold';
  if (isComplete && isSelectedDigit) {
    return `${base} ${weight} border-success bg-complete-strong text-success-foreground`;
  }
  if (isComplete) {
    return `${base} ${weight} border-success/60 bg-complete text-success-foreground hover:bg-complete-strong`;
  }
  if (isSelectedDigit) {
    return `${base} ${weight} border-primary-border bg-primary-soft text-foreground hover:bg-selected`;
  }
  return `${base} ${weight} border-border bg-surface text-foreground hover:bg-surface-muted`;
}

export function NumberPad() {
  const enterValue = useGameStore((s) => s.enterValue);
  const clearCell = useGameStore((s) => s.clearCell);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const notesMode = useGameStore((s) => s.notesMode);
  const toggleNotesMode = useGameStore((s) => s.toggleNotesMode);
  const canUndo = useGameStore(selectCanUndo);
  const canRedo = useGameStore(selectCanRedo);
  const finishedAt = useGameStore((s) => s.finishedAt);
  const pausedAt = useGameStore((s) => s.pausedAt);
  const board = useGameStore((s) => s.board);
  const selected = useGameStore((s) => s.selected);
  const disabled = finishedAt !== null || pausedAt !== null;

  // Value of the currently selected cell (or null). Drives the per-button
  // selected-digit highlight.
  const selectedDigit =
    board && selected !== null ? effectiveCellValue(board.cells[selected]!) : null;
  // Digits whose 9 instances are all placed. Drives the green + light-weight
  // treatment on the matching number-pad buttons.
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
              ? 'border-warning-border bg-warning text-warning-foreground shadow-sm hover:bg-warning-hover'
              : 'border-border bg-surface text-foreground hover:bg-surface-muted',
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
