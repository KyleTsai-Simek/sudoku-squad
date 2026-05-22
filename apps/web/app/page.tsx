import Link from 'next/link';
import { SAMPLE_PUZZLES } from '@/lib/sample-puzzles';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Sudoku Squad</h1>
        <p className="mt-3 text-base text-stone-600">
          Multiplayer sudoku — play together or race to the finish.
        </p>
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <Link
          href="/play"
          className="flex-1 rounded-xl bg-stone-900 px-5 py-4 text-center text-base font-medium text-white shadow-sm hover:bg-stone-800"
        >
          New game
        </Link>
        <button
          type="button"
          disabled
          className="flex-1 cursor-not-allowed rounded-xl border border-dashed border-stone-300 px-5 py-4 text-center text-base font-medium text-stone-400"
          title="Phase 2"
        >
          Battle (soon)
        </button>
        <button
          type="button"
          disabled
          className="flex-1 cursor-not-allowed rounded-xl border border-dashed border-stone-300 px-5 py-4 text-center text-base font-medium text-stone-400"
          title="Phase 3"
        >
          Coop (soon)
        </button>
      </div>

      <section className="w-full">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-stone-500">
          Quick start
        </p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SAMPLE_PUZZLES.map((p, i) => (
            <li key={p.id}>
              <Link
                href={`/play?seed=${p.id}`}
                className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 hover:border-stone-400"
              >
                <span>Puzzle {i + 1}</span>
                <span className="text-xs uppercase tracking-wide text-stone-500">
                  {p.difficulty}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-stone-400">Phase 1 in progress · single-player web</p>
    </main>
  );
}
