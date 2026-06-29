import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildShareTitle, formatShareTime } from '@/lib/share-copy';
import { difficultyLabel } from '@/lib/difficulty-labels';
import { fetchPublicPuzzle } from '@/lib/public-puzzle';
import { siteUrl } from '@/lib/site-url';
import {
  buildPlayHref,
  decodeShareTime,
  isValidDailyDate,
  isValidShareCode,
} from '@/lib/share-url';

interface Props {
  params: Promise<{ code: string; time: string }>;
  searchParams: Promise<{ d?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { code, time } = await params;
  const { d } = await searchParams;
  const solveTimeMs = decodeShareTime(time);
  const dailyDate = isValidDailyDate(d) ? d : undefined;
  const puzzle = isValidShareCode(code) ? await fetchPublicPuzzle(code) : null;

  if (!puzzle || solveTimeMs === null) {
    return {
      title: 'Try a Sudoku Squad puzzle',
      description: 'Open this Sudoku Squad challenge and play the same puzzle.',
    };
  }

  const title = buildShareTitle({ difficulty: puzzle.difficulty });
  const description = `${difficultyLabel(puzzle.difficulty)} puzzle finished in ${formatShareTime(
    solveTimeMs,
  )}.`;
  const canonical = shareCanonicalUrl(code, time, dailyDate);
  const imageUrl = shareImageUrl(code, time, dailyDate);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'Sudoku Squad',
      type: 'website',
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function SharePage({ params, searchParams }: Props) {
  const { code, time } = await params;
  const { d } = await searchParams;
  const solveTimeMs = decodeShareTime(time);
  if (!isValidShareCode(code) || solveTimeMs === null) notFound();
  const puzzle = await fetchPublicPuzzle(code);
  if (!puzzle) notFound();

  const dailyDate = isValidDailyDate(d) ? d : undefined;
  const category = shareCategory({
    dailyDate,
    difficulty: difficultyLabel(puzzle.difficulty),
  });
  const playHref = buildPlayHref({
    puzzleCode: code,
    dailyDate,
    difficulty: puzzle.difficulty,
  });

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold text-muted hover:text-foreground">
            Sudoku Squad
          </Link>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-widest text-muted">
            share
          </span>
        </header>

        <section className="grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-center">
          <PuzzleCard givens={puzzle.givens} />
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-warning">
                {category}
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-normal">
                Try this puzzle
              </h1>
              <p className="mt-3 text-lg text-muted">
                {difficultyLabel(puzzle.difficulty)} puzzle finished in{' '}
                <span className="font-semibold text-foreground">
                  {formatShareTime(solveTimeMs)}
                </span>
                .
              </p>
            </div>

            <Link
              href={playHref}
              className="inline-flex w-fit items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Play this puzzle
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function shareCanonicalUrl(code: string, time: string, dailyDate?: string): string {
  const url = new URL(`/s/${code}/${time}`, siteUrl());
  if (dailyDate) url.searchParams.set('d', dailyDate);
  return url.toString();
}

function shareImageUrl(code: string, time: string, dailyDate?: string): string {
  const url = new URL(`/s/${code}/${time}/opengraph-image`, siteUrl());
  if (dailyDate) url.searchParams.set('d', dailyDate);
  return url.toString();
}

function shareCategory({
  dailyDate,
  difficulty,
}: {
  dailyDate?: string;
  difficulty: string;
}): string {
  if (!dailyDate) return `${difficulty} puzzle`;
  return `${formatMonthDay(dailyDate)} Daily ${difficulty} puzzle`;
}

function formatMonthDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = year && month && day ? new Date(Date.UTC(year, month - 1, day, 12)) : new Date();
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(parsed);
}

function PuzzleCard({ givens }: { givens: number[] }) {
  return (
    <div className="mx-auto grid aspect-square w-full max-w-[min(86vw,360px)] grid-cols-9 overflow-hidden rounded-lg border-2 border-board-line-strong bg-cell shadow-xl">
      {givens.map((value, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const strongRight = col === 2 || col === 5;
        const strongBottom = row === 2 || row === 5;
        return (
          <div
            key={index}
            className={[
              'flex aspect-square items-center justify-center border-board-line text-sm font-semibold',
              col < 8 ? 'border-r' : '',
              row < 8 ? 'border-b' : '',
              strongRight ? 'border-r-2 border-r-board-line-strong' : '',
              strongBottom ? 'border-b-2 border-b-board-line-strong' : '',
              value ? 'bg-cell-given text-muted' : 'bg-cell text-transparent',
            ].join(' ')}
          >
            {value || ''}
          </div>
        );
      })}
    </div>
  );
}
