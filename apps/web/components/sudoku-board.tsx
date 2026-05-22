'use client';

import {
  notesToArray,
  unitsFor,
  cellValue as effectiveCellValue,
  digitCounts,
} from '@sudoku-squad/core';
import type { CellIndex } from '@sudoku-squad/core';
import { useGameStore } from '@/lib/game-store';

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function SudokuBoard() {
  const board = useGameStore((s) => s.board);
  const selected = useGameStore((s) => s.selected);
  const selectCell = useGameStore((s) => s.selectCell);
  const settings = useGameStore((s) => s.settings);
  const conflicts = useGameStore((s) => s.conflicts);
  const incorrect = useGameStore((s) => s.incorrect);
  const finishedAt = useGameStore((s) => s.finishedAt);

  if (!board) return null;

  const selUnits = selected !== null ? unitsFor(selected) : null;
  const selValue = selected !== null ? effectiveCellValue(board.cells[selected]!) : null;
  // Digits whose 9 instances are all placed. When the selected cell holds one
  // of these, the same-value highlight goes soft green instead of amber — see
  // QoL change #2.
  const counts = digitCounts(board);
  const selectedDigitComplete = selValue !== null && (counts.get(selValue) ?? 0) === 9;

  return (
    <div
      role="grid"
      aria-label="Sudoku board"
      // Width is rounded down to (9N + 4)px so the inner content area (after
      // the 2px container border on each side) is exactly divisible by 9.
      // This gives every cell an identical integer pixel width, which kills
      // the sub-pixel anti-aliasing variation that otherwise makes some inner
      // gridlines look fractionally thicker than others. CSS `round()` is
      // supported in all modern browsers (Chrome 112+, Safari 15.4+, Firefox 118+).
      className="grid aspect-square w-[calc(round(down,min(92vw,560px)-4px,9px)+4px)] select-none grid-cols-9 overflow-hidden rounded-lg border-2 border-stone-900 bg-stone-900 shadow-sm"
    >
      {board.cells.map((cell, i) => {
        const { row, col, box } = unitsFor(i);
        const isSelected = selected === i;
        const inSelectedUnit =
          !!selUnits &&
          (selUnits.row === row || selUnits.col === col || selUnits.box === box);
        const ev = effectiveCellValue(cell);
        const sameValue = settings.highlightSameValue && selValue !== null && ev === selValue;
        const isConflict = conflicts.has(i as CellIndex);
        const isIncorrect = incorrect.has(i as CellIndex);
        const isGiven = cell.given !== null;
        const value = ev;

        // 3x3 box visual separation: thicker right/bottom borders on box edges.
        const rightBorder = col === 2 || col === 5 ? 'border-r-2 border-r-stone-900' : 'border-r border-r-stone-300';
        const bottomBorder = row === 2 || row === 5 ? 'border-b-2 border-b-stone-900' : 'border-b border-b-stone-300';
        const lastCol = col === 8 ? 'border-r-0' : '';
        const lastRow = row === 8 ? 'border-b-0' : '';

        // Pick a single background class so Tailwind's stylesheet order doesn't
        // let `bg-white` shadow conditional overrides. The selected cell and
        // same-value cells go SOFT GREEN instead of amber when the selected
        // digit is complete (all 9 instances placed) — QoL change.
        let bg = 'bg-white';
        if (isConflict && isSelected) bg = 'bg-red-200';
        else if (isSelected) bg = selectedDigitComplete ? 'bg-emerald-200' : 'bg-amber-200';
        else if (isConflict) bg = 'bg-red-100';
        else if (sameValue) bg = selectedDigitComplete ? 'bg-emerald-100' : 'bg-amber-100';
        else if (inSelectedUnit) bg = 'bg-amber-50';

        // Same dance for text color.
        let textColor = 'text-stone-900';
        if (isIncorrect && !isGiven) textColor = 'text-red-600';
        else if (!isGiven && value !== null) textColor = 'text-blue-700';

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
              'aspect-square text-[clamp(1rem,4.2vw,1.75rem)] font-medium',
              // Unify the base border color for all four sides. Without this,
              // Tailwind's preflight leaves border-top-color and border-left-color
              // at the default gray-200 even though their width is 0. At
              // non-integer cell widths the browser anti-aliases corners by
              // blending colors from adjacent edges, which surfaces the
              // gray-200/stone-300 mismatch as faint tonal seams on some
              // corners. The per-side classes below still win on specificity.
              'border-stone-300',
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
              <NotesGrid mask={cell.notes} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NotesGrid({ mask }: { mask: number }) {
  const notes = new Set(notesToArray(mask));
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-3 p-0.5 text-[clamp(0.5rem,1.5vw,0.7rem)] leading-none text-stone-500">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <span key={n} className="flex items-center justify-center">
          {notes.has(n as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) ? n : ''}
        </span>
      ))}
    </div>
  );
}
