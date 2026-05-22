# @sudoku-squad/core

Platform-agnostic TypeScript package: the game engine. Imported by `apps/web` today; `apps/ios` will share it in Phase 4. A `sync/` module will be added in Phase 2 for multiplayer sync helpers.

## Rules

This package **must not** import from:

- `next/*`, `react-dom/*`
- `react-native/*`, `expo/*`, `expo-*`
- `scripts/ingest/**` or `@sudoku-squad/ingest` (the Norvig solver lives there — must never ship to clients)
- `window`, `document`, `navigator`, `localStorage`, or any other DOM/browser global

`react` itself is allowed for hooks only — no JSX components belong here.

These rules are enforced by `eslint.config.js` (flat config, `no-restricted-imports` + `no-restricted-globals`). The lint runs in CI on every PR. See [../../CLAUDE.md](../../CLAUDE.md) §2 for the full architectural context.

## Modules

| Path | What's in it |
|---|---|
| `src/types/` | Shared TS types: `BoardState`, `Cell`, `Move`, `Puzzle`, `PuzzleCode`, `PuzzleId`, `RoomCode`, etc. |
| `src/puzzle/` | `createBoard`, `findConflicts`, `isCompleteWithSolution`, `unitsFor`, `cellValue`. No solver. |
| `src/game/` | `applyMove` reducer + `applyMoves` replay helper, `notes/` bitmask helpers, `history/` undo+redo wrapper. |
| `src/sync/` | (Phase 2) Supabase channel helpers + conflict-resolution logic for multiplayer rooms. |

The puzzle code (6-char base36 hash of givens) is the cross-mode identifier — `BoardState.puzzleCode` carries it. See [docs/DECISIONS.md #0019 / #0020](../../docs/DECISIONS.md).

## Testing

We test in three layers per [DECISIONS.md #0013](../../docs/DECISIONS.md):

```bash
pnpm test           # unit + property tests (Vitest + fast-check). 36/36.
pnpm test:watch
pnpm lint           # purity rules
pnpm typecheck
```

Property tests use `fast-check` and live next to their target module (e.g. `reducer.test.ts`).
