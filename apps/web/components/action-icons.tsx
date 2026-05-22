/**
 * Small inline SVG glyphs for the secondary action buttons under the number
 * pad (Clear / Undo / Redo). Same conventions as `pencil-icon.tsx`: 14px
 * square, inherits color from surrounding text, decorative (`aria-hidden`).
 *
 * Hand-rolled rather than pulled from a library because we only need three
 * and the lucide-react import would dominate the page weight.
 */

const COMMON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Eraser glyph — angled bar with a cut. */
export function EraserIcon() {
  return (
    <svg {...COMMON}>
      <path d="M3 13l6-9 5 3-6 9H4l-1-3z" />
      <path d="M9 4l5 3" />
    </svg>
  );
}

/** Curved arrow pointing left for Undo. */
export function UndoIcon() {
  return (
    <svg {...COMMON}>
      <path d="M5.5 5h5a3.5 3.5 0 010 7H6" />
      <path d="M5.5 2.5L3 5l2.5 2.5" />
    </svg>
  );
}

/** Curved arrow pointing right for Redo. Mirror of UndoIcon. */
export function RedoIcon() {
  return (
    <svg {...COMMON}>
      <path d="M10.5 5h-5a3.5 3.5 0 000 7H10" />
      <path d="M10.5 2.5L13 5l-2.5 2.5" />
    </svg>
  );
}
