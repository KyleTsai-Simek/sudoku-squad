'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { getDailyPuzzles, type DailyPuzzle } from '@/lib/daily-puzzles';

const LABEL: Record<DailyPuzzle['difficulty'], string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export default function DailyPage() {
  const [puzzles, setPuzzles] = useState<DailyPuzzle[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await getDailyPuzzles();
      if (!cancelled) setPuzzles(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const date = puzzles?.[0]?.date;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-6 py-4">
      <AppHeader
        left={
          <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
            ← Menu
          </Link>
        }
        center={<span className="text-xs uppercase tracking-widest text-muted">Daily</span>}
      />

      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Daily Sudoku
        </h1>
        {date ? <p className="mt-2 text-sm text-muted">{formatDailyDate(date)}</p> : null}
      </div>

      <div className="flex flex-col gap-3">
        {puzzles === null ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted">
            Loading…
          </div>
        ) : puzzles.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            Daily puzzles are unavailable right now.
          </div>
        ) : (
          puzzles.map((puzzle) => (
            <Link
              key={`${puzzle.date}-${puzzle.difficulty}`}
              href={`/play/${puzzle.code}?daily=${puzzle.date}&dailyDifficulty=${puzzle.difficulty}`}
              className="group flex flex-col items-start gap-1 rounded-xl border border-primary bg-primary px-5 py-4 text-left text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              <span className="text-xs font-medium uppercase tracking-widest">
                {LABEL[puzzle.difficulty]}
              </span>
              <span className="text-lg font-semibold">Play today&apos;s puzzle</span>
              <span className="font-mono text-xs text-primary-foreground/70 group-hover:text-primary-foreground/80">
                {puzzle.code}
              </span>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}

function formatDailyDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
