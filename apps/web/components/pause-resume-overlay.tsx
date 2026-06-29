'use client';

interface PauseResumeOverlayProps {
  title?: string;
  onResume: () => void;
}

export function PauseResumeOverlay({
  title = 'Ready to continue?',
  onResume,
}: PauseResumeOverlayProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-paused-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-surface/90 px-6 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">
          Game paused
        </p>
        <h2 id="game-paused-title" className="text-2xl font-semibold text-foreground">
          {title}
        </h2>
        <button
          type="button"
          onClick={onResume}
          className="mt-1 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Resume
        </button>
      </div>
    </div>
  );
}
