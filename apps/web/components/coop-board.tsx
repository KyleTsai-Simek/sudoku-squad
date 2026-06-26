'use client';

import {
  notesToArray,
  unitsFor,
  cellValue as effectiveCellValue,
  digitCounts,
} from '@sudoku-squad/core';
import type { CellIndex } from '@sudoku-squad/core';
import { useCoopStore } from '@/lib/coop-store';

const EMPTY_SET: Set<CellIndex> = new Set();

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Battle-mode board. Visually identical to the single-player SudokuBoard but
 * reads from `useCoopStore`. There is intentional duplication with
 * `components/sudoku-board.tsx`; sharing was rejected for V1 because the two
 * stores have different shapes and adapter abstractions would dominate the
 * code path. Phase 3 (coop) is a good moment to refactor.
 */
export function CoopBoard() {
  const board = useCoopStore((s) => s.board);
  const selected = useCoopStore((s) => s.selected);
  const selectCell = useCoopStore((s) => s.selectCell);
  const settings = useCoopStore((s) => s.settings);
  const conflicts = useCoopStore((s) => s.conflicts);
  // V1 coop doesn't surface per-cell autoCheck flags (deferred to Phase 3.x).
  const incorrect: Set<CellIndex> = EMPTY_SET;
  const finishedAt = useCoopStore((s) => s.finishedAt);

  if (!board) return null;

  const selUnits = selected !== null ? unitsFor(selected) : null;
  const selValue = selected !== null ? effectiveCellValue(board.cells[selected]!) : null;
  // See sudoku-board.tsx for the rationale on the completed-digit green tint.
  const counts = digitCounts(board);
  const selectedDigitComplete = selValue !== null && (counts.get(selValue) ?? 0) === 9;

  return (
    <div
      role="grid"
      aria-label="Sudoku board"
      // See sudoku-board.tsx for why this snapped width matters.
      className="grid aspect-square w-[calc(round(down,min(92vw,560px)-4px,9px)+4px)] select-none grid-cols-9 overflow-hidden rounded-lg border-2 border-board-line-strong bg-board-line-strong shadow-sm"
    >
      {board.cells.map((cell, i) => {
        const { row, col, box } = unitsFor(i);
        const isSelected = selected === i;
        const inSelectedUnit =
          !!selUnits &&
          (selUnits.row === row || selUnits.col === col || selUnits.box === box);
        const ev = effectiveCellValue(cell);
        const sameValue =
          settings.highlightSameValue && selValue !== null && ev === selValue;
        const isConflict = conflicts.has(i as CellIndex);
        const isIncorrect = incorrect.has(i as CellIndex);
        const isGiven = cell.given !== null;
        const value = ev;

        const rightBorder =
          col === 2 || col === 5
            ? 'border-r-2 border-r-board-line-strong'
            : 'border-r border-r-board-line';
        const bottomBorder =
          row === 2 || row === 5
            ? 'border-b-2 border-b-board-line-strong'
            : 'border-b border-b-board-line';
        const lastCol = col === 8 ? 'border-r-0' : '';
        const lastRow = row === 8 ? 'border-b-0' : '';

        let bg = isGiven ? 'bg-cell-given' : 'bg-cell';
        if (isConflict && isSelected) bg = 'bg-danger-strong';
        else if (isSelected) bg = selectedDigitComplete ? 'bg-complete-strong' : 'bg-selected';
        else if (isConflict) bg = 'bg-danger-soft';
        else if (sameValue) bg = selectedDigitComplete ? 'bg-complete' : 'bg-same';
        else if (inSelectedUnit) bg = 'bg-related';

        let textColor = 'text-foreground';
        if (isIncorrect && !isGiven) textColor = 'text-danger';
        else if (!isGiven && value !== null) textColor = 'text-cell-entered';

        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={`row ${row + 1}, column ${col + 1}${value ? `, value ${value}` : ', empty'}${isGiven ? ', given' : ''}`}
            aria-selected={isSelected}
            onClick={() => selectCell(i)}
            disabled={finishedAt !== null}
            className={cn(
              'relative flex items-center justify-center outline-none transition-colors',
              // See sudoku-board.tsx for the container-query + overflow rationale.
              'aspect-square overflow-hidden [container-type:inline-size]',
              'min-w-0 min-h-0 text-[min(55cqw,1.75rem)] font-medium',
              // See sudoku-board.tsx for why this base color matters.
              'border-board-line',
              bg,
              textColor,
              rightBorder,
              bottomBorder,
              lastCol,
              lastRow,
              isGiven && 'font-semibold',
            )}
          >
            {value !== null ? (
              <span>{value}</span>
            ) : cell.notes !== 0 ? (
              <NotesGrid mask={cell.notes} highlight={selValue} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NotesGrid({ mask, highlight }: { mask: number; highlight: number | null }) {
  const notes = new Set(notesToArray(mask));
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-3 text-[min(24cqw,0.7rem)] leading-none text-note-text">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => {
        const present = notes.has(n as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
        const isHighlighted = present && highlight === n;
        return (
          <span
            key={n}
            className={
              isHighlighted
                ? 'flex items-center justify-center font-bold text-foreground'
                : 'flex items-center justify-center'
            }
          >
            {present ? n : ''}
          </span>
        );
      })}
    </div>
  );
}
