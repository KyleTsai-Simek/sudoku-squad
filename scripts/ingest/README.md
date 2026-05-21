# @sudoku-squad/ingest

One-off scripts for ingesting puzzles from the Kaggle 9M Sudoku dataset into Supabase.

**This package is not shipped to clients.** It runs locally, talks to Supabase via the service-role key, and exits. The Norvig solver lives here (not in `packages/core`) because it's only needed at ingest time. Per [docs/DECISIONS.md #0012](../../docs/DECISIONS.md).

## Dataset

We use the Kaggle [9 Million Sudoku Puzzles](https://www.kaggle.com/datasets/rohanrao/sudoku) dataset (or the 1M variant if download size is an issue). Each row: `puzzle,solution[,difficulty]`. Both columns are 81-char strings of digits 0–9 (0 = empty in `puzzle`).

Download to `scripts/ingest/data/sudoku.csv` — gitignored.

## Running

```bash
# From repo root
cp .env.example .env.local
# Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

pnpm --filter @sudoku-squad/ingest ingest
```

## Validation gates

Each row must pass:

1. `hasUniqueSolution(puzzle)` — verifies the puzzle is well-formed (exactly one solution).
2. `solve(puzzle)` matches the dataset's claimed `solution` — sanity check on the dataset itself.

Rows that fail are logged and skipped. We expect ~99.9% pass rate on the Kaggle dataset.
