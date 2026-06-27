import Link from 'next/link';
import { createShareToken, type ShareTokenPayload } from '@/lib/share-token';
import { SAMPLE_PUZZLES } from '@/lib/sample-puzzles';

export const dynamic = 'force-dynamic';

const CASES: Array<{ label: string; payload: ShareTokenPayload }> = [
  {
    label: 'Solo Medium, quick',
    payload: {
      version: 1,
      puzzleCode: '3santv',
      difficulty: 'medium',
      solveTimeMs: 182_000,
      mode: 'single',
    },
  },
  {
    label: 'Daily Hard',
    payload: {
      version: 1,
      puzzleCode: 'k9i5iv',
      difficulty: 'hard',
      solveTimeMs: 542_000,
      mode: 'single',
      dailyDate: '2026-06-27',
    },
  },
  {
    label: 'Battle Expert',
    payload: {
      version: 1,
      puzzleCode: 'wzkgre',
      difficulty: 'expert',
      solveTimeMs: 731_000,
      mode: 'battle',
      roomCode: 'abc123',
      playerCount: 3,
    },
  },
  {
    label: 'Co-op Hard',
    payload: {
      version: 1,
      puzzleCode: 'mdkr7p',
      difficulty: 'hard',
      solveTimeMs: 906_000,
      mode: 'coop',
      roomCode: 'coops1',
      playerCount: 4,
    },
  },
];

export default function SharePreviewPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header>
          <Link href="/" className="text-sm font-semibold text-muted hover:text-foreground">
            Sudoku Squad
          </Link>
          <h1 className="mt-4 text-3xl font-semibold">Share previews</h1>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {CASES.map(({ label, payload }) => {
            const token = createShareToken(payload);
            const href = `/s/${token}`;
            return (
              <section
                key={label}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-xs text-muted">
                    {payload.puzzleCode} · {payload.mode} · {payload.solveTimeMs}ms
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={href}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    Open page
                  </Link>
                  <Link
                    href={`${href}/opengraph-image`}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-surface-muted"
                  >
                    Open OG image
                  </Link>
                </div>
              </section>
            );
          })}
        </div>

        <p className="text-sm text-muted">
          Sample pack available: {SAMPLE_PUZZLES.map((p) => p.code).join(', ')}
        </p>
      </div>
    </main>
  );
}
