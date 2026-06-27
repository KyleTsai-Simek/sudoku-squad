import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyShareToken } from '@/lib/share-token';
import { buildShareMessage, buildShareTitle, formatShareTime, shareModeLabel } from '@/lib/share-copy';
import { difficultyLabel } from '@/lib/difficulty-labels';
import { fetchPublicPuzzle } from '@/lib/public-puzzle';
import { siteUrl } from '@/lib/site-url';

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const payload = verifyShareToken(token);
  if (!payload) {
    return {
      title: 'Try a Sudoku Squad puzzle',
      description: 'Open this Sudoku Squad challenge and play the same puzzle.',
    };
  }
  const title = buildShareTitle(payload);
  const description = buildShareMessage(payload);
  const canonical = `${siteUrl()}/s/${token}`;
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
      images: [{ url: `${canonical}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${canonical}/opengraph-image`],
    },
  };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const payload = verifyShareToken(token);
  if (!payload) notFound();
  const puzzle = await fetchPublicPuzzle(payload.puzzleCode);
  if (!puzzle) notFound();

  const mode =
    payload.mode === 'single'
      ? 'Solo puzzle'
      : `${shareModeLabel(payload.mode)}${payload.playerCount ? ` · ${payload.playerCount} players` : ''}`;

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
                {mode}
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-normal">
                Try this puzzle
              </h1>
              <p className="mt-3 text-lg text-muted">
                A {difficultyLabel(payload.difficulty)} Sudoku Squad puzzle finished in{' '}
                <span className="font-semibold text-foreground">
                  {formatShareTime(payload.solveTimeMs)}
                </span>
                .
              </p>
            </div>

            <Link
              href={`/play/${payload.puzzleCode}`}
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
