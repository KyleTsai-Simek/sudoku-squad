import { createBoard } from '@sudoku-squad/core';

export default function HomePage() {
  // Sanity check that the workspace import is wired up.
  const _board = createBoard('demo', new Array(81).fill(0));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="text-5xl font-semibold tracking-tight">Sudoku Squad</h1>
      <p className="text-lg text-stone-600">
        Multiplayer sudoku — play together or race to the finish.
      </p>
      <p className="rounded-md bg-stone-200 px-4 py-2 text-sm text-stone-700">
        Phase 0 scaffold. Game UI lands in Phase 1.
      </p>
    </main>
  );
}
