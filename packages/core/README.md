# @sudoku-squad/core

Platform-agnostic TypeScript package containing the game engine and (later) the sync layer for Sudoku Squad. Imported by both `apps/web` and (eventually) `apps/ios`.

## Rules

This package **must not** import from any of:

- `next/*`, `react-dom/*`
- `react-native/*`, `expo/*`
- `window`, `document`, `navigator`, `localStorage`, or anything DOM-specific
- The Norvig solver (it lives in `scripts/ingest/`, not here)

`react` itself is allowed for hooks only — no JSX components belong in this package.

See [../../CLAUDE.md](../../CLAUDE.md) §2 for the full rules.

## Modules

- `types/` — shared TypeScript types (BoardState, Move, Puzzle, etc.)
- `puzzle/` — board construction, conflict detection, completion checks
- `game/` — move reducer, game state machine (Phase 1)
- `sync/` — Supabase channel helpers, conflict resolution (Phase 2)

## Testing

We test in three layers per [DECISIONS.md #0013](../../docs/DECISIONS.md):

```bash
pnpm test           # unit + property tests
pnpm test:watch     # watch mode
```

Property tests use `fast-check` and live next to their target module (e.g. `validator.property.test.ts`).
