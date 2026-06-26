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
  // of these, the same-value highlight goes soft green instead of blue — see
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
      className="grid aspect-square w-[calc(round(down,min(92vw,560px)-4px,9px)+4px)] select-none grid-cols-9 overflow-hidden rounded-lg border-2 border-board-line-strong bg-board-line-strong shadow-sm"
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

        // Pick a single background class so Tailwind's stylesheet order doesn't
        // let `bg-surface` shadow conditional overrides. The selected cell and
        // same-value cells go SOFT GREEN instead of blue when the selected
        // digit is complete (all 9 instances placed) — QoL change.
        let bg = isGiven ? 'bg-cell-given' : 'bg-cell';
        if (isConflict && isSelected) bg = 'bg-danger-strong';
        else if (isSelected) bg = selectedDigitComplete ? 'bg-complete-strong' : 'bg-selected';
        else if (isConflict) bg = 'bg-danger-soft';
        else if (sameValue) bg = selectedDigitComplete ? 'bg-complete' : 'bg-same';
        else if (inSelectedUnit) bg = 'bg-related';

        // Same dance for text color.
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
              // Container-query font sizing: value scales with the cell width
              // (cqw), not the viewport, so small-screen cells get proportional
              // digits instead of the old clamp floor. overflow-hidden +
              // min-w/h-0 guarantee glyph ascenders/descenders or sub-pixel
              // rounding can't perturb the row, which would otherwise cascade
              // into neighbors via aspect-square.
              'aspect-square overflow-hidden [container-type:inline-size]',
              'min-w-0 min-h-0 text-[min(55cqw,1.75rem)] font-medium',
              // Unify the base border color for all four sides. Without this,
              // Tailwind's preflight leaves border-top-color and border-left-color
              // at the default gray-200 even though their width is 0. At
              // non-integer cell widths the browser anti-aliases corners by
              // blending colors from adjacent edges, which surfaces the
              // gray-200/stone-300 mismatch as faint tonal seams on some
              // corners. The per-side classes below still win on specificity.
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
