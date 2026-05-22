/**
 * Small pencil glyph used by the Notes toggle. `filled` renders the body
 * filled with currentColor (the "on" state); otherwise the body is outlined.
 * Sized to sit on a single-line button — about 14px square — and inherits
 * its color from the surrounding text.
 */
export function PencilIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.5 1.5l3 3L5 14l-3.5.5L2 11 11.5 1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
      />
      {!filled && (
        <path
          d="M10 3l3 3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
