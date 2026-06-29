import Link from 'next/link';
import { buildShareMessage, formatShareTime } from '@/lib/share-copy';
import { buildSharePath, type ShareMode } from '@/lib/share-url';
import { SAMPLE_PUZZLES } from '@/lib/sample-puzzles';
import type { Difficulty } from '@sudoku-squad/core';

export const dynamic = 'force-dynamic';

interface SharePreviewCase {
  label: string;
  puzzleCode: string;
  difficulty: Difficulty;
  solveTimeMs: number;
  mode: ShareMode;
  dailyDate?: string;
}

const CASES: SharePreviewCase[] = [
  {
    label: 'Solo Medium, quick',
    puzzleCode: '3santv',
    difficulty: 'medium',
    solveTimeMs: 182_000,
    mode: 'single',
  },
  {
    label: 'Daily Hard',
    puzzleCode: 'k9i5iv',
    difficulty: 'hard',
    solveTimeMs: 542_000,
    mode: 'single',
    dailyDate: '2026-06-29',
  },
  {
    label: 'Battle Expert',
    puzzleCode: 'wzkgre',
    difficulty: 'expert',
    solveTimeMs: 731_000,
    mode: 'battle',
  },
  {
    label: 'Co-op Hard',
    puzzleCode: 'mdkr7p',
    difficulty: 'hard',
    solveTimeMs: 906_000,
    mode: 'coop',
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
          {CASES.map((preview) => {
            const href = buildSharePath(preview);
            return (
              <section
                key={preview.label}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div>
                  <p className="text-sm font-semibold">{preview.label}</p>
                  <p className="text-xs text-muted">
                    {preview.puzzleCode} · {preview.mode} · {formatShareTime(preview.solveTimeMs)}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {buildShareMessage(preview)}
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
