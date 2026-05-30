# @sudoku-squad/ingest

One-off scripts for populating the Supabase `puzzles` table. The whole bank is now **QQWing-generated** via **two pipelines**:

1. **`ingest:qqwing`** — the two easiest tiers, by clue count (`src/ingest-qqwing.ts`). See §4.
2. **`ingest:qqwing-graded`** — the four upper tiers, graded by QQWing's difficulty class + technique counts (`src/ingest-qqwing-graded.ts`). See §4b.

Together they seed **15,000 puzzles across six tiers, 2,500 each**: `warmup` / `easy` (clue-count graded, negative ratings, [#0033](../../docs/DECISIONS.md)) and `medium` / `hard` / `expert` / `killer` (technique graded, [#0042](../../docs/DECISIONS.md)). `killer` is hidden from the UI.

> **The Kaggle pipeline (`ingest`, `src/index.ts`) is dormant** as of [#0042](../../docs/DECISIONS.md) — the upper tiers no longer come from the Kaggle 3M dataset. The script and the radcliffe audit tooling are kept for reference but are no longer the source of truth, and the dataset (§1) is no longer needed to seed the bank.

**This package is not shipped to clients.** It runs locally, talks to Supabase via the service-role key, and exits. The Norvig solver lives here (not in `packages/core`) because it's only needed at ingest time. Per [docs/DECISIONS.md #0012](../../docs/DECISIONS.md).

---

## 1. Get the dataset

The `medium` / `hard` / `expert` / `killer` tiers come from the [3 million Sudoku puzzles with ratings](https://www.kaggle.com/datasets/radcliffe/3-million-sudoku-puzzles-with-ratings) dataset (~215 MB zipped, ~535 MB CSV after extract). The dataset ships a numeric `difficulty` rating column which the ingest uses to band puzzles into tiers — see [DECISIONS.md #0031](../../docs/DECISIONS.md)–[#0034](../../docs/DECISIONS.md).

The `warmup` / `easy` tiers are **generated locally** via QQWing and don't need this dataset — see §5.

The script also accepts other Kaggle sudoku CSVs (`bryanpark/sudoku`, `rohanrao/sudoku`) — header layout is auto-detected. If the CSV lacks a difficulty/rating column, the script falls back to clue count.

### With the Kaggle CLI

```bash
# One-time setup
pip3 install --user kaggle
# Drop your kaggle.json (from https://www.kaggle.com/settings → API → Create New Token)
# into ~/.kaggle/kaggle.json and chmod 600 it. KAT-format tokens (KGAT_*) work
# directly as the `key` field; the username field can be left blank.

# From the repo root:
mkdir -p scripts/ingest/data
cd scripts/ingest/data
kaggle datasets download -d radcliffe/3-million-sudoku-puzzles-with-ratings
unzip 3-million-sudoku-puzzles-with-ratings.zip
```

You should end up with `sudoku-3m.csv` inside `scripts/ingest/data/`. The directory is gitignored — the file never lands in version control.

### Without the CLI

Download the dataset zip from the Kaggle UI, extract, and drop the `.csv` into `scripts/ingest/data/`.

---

## 2. Configure credentials

The ingest writes via the Supabase service-role key. **Never** put this in `apps/web` or any client bundle.

`.env.local` at the repo root:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOURPROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service_role, not anon
```

`.env.example` lists the full set. Both are loaded by `dotenv/config` from the repo root.

---

## 3. Run the Kaggle ingest

```bash
# From repo root
pnpm --filter @sudoku-squad/ingest ingest                 # appends ~10,000 rows
pnpm --filter @sudoku-squad/ingest ingest -- --dry-run    # parse + bucket, no writes
pnpm --filter @sudoku-squad/ingest ingest -- --truncate   # wipe + rebuild (see below)
```

What it does:

1. Finds the largest `.csv` under `scripts/ingest/data/`.
2. Streams rows, parsing the puzzle/solution columns (header names auto-detected — handles `puzzle`/`solution`, `quizzes`/`solutions`, etc.).
3. Buckets each row into one of the four Kaggle tiers:
   - **From a `difficulty`/`level`/`rating` column** if the dataset has one, using half-open rating bands: `[0, 0.75)` → medium, `[0.75, 2.5)` → hard, `[2.5, 5.0)` → expert, `[5.0, 7.0)` → killer.
   - **Otherwise from clue count** (fallback for datasets without a rating column).
   - A per-(tier, clue-count) target distribution shapes each tier toward a realistic clue spread (`TARGET_PER_CELL` in [src/index.ts](src/index.ts)).
4. Runs the Norvig solver on every kept candidate to verify it has a unique solution *and* that the solution matches what the dataset claims.
5. Computes `puzzle.code` via the same algorithm as the Postgres `puzzle_code_for` function — see [DECISIONS.md #0019](../../docs/DECISIONS.md).
6. Stops once each tier hits its target (**2,500 each across medium / hard / expert / killer = 10,000**).
7. Inserts the sampled rows (including `code`) into the Supabase `puzzles` table in batches of **500**.

Tiers, rating bands, targets, and batch size are constants at the top of [src/index.ts](src/index.ts) — edit and re-run if you want a different mix.

The script **appends** by default. Pass `--truncate` to wipe and rebuild from scratch — this cascades through everything that references `puzzles` (`player_completions`, `rooms` → `room_players` + `moves`), so only use it on a dev project.

---

## 4. Generate the easier tiers (QQWing)

```bash
pnpm --filter @sudoku-squad/ingest ingest:qqwing          # appends ~5,000 rows
```

Generates **2,500 `warmup` + 2,500 `easy`** puzzles locally with QQWing — no dataset required. These sit below the upper tiers with negative ratings in `[-10, 0)`: clues 35–40 → `warmup`, clues 29–34 → `easy`. Each candidate is solver-verified for a unique solution and coded identically to the graded path. Runs ~60 minutes single-threaded. Targets live in `TARGET_PER_CELL` at the top of [src/ingest-qqwing.ts](src/ingest-qqwing.ts). See [DECISIONS.md #0033](../../docs/DECISIONS.md).

> Requires migrations `0012` (extends the `difficulty` check constraint for the easier tiers) and `0013` (the tier shift-rename) to be applied first.

---

## 4b. Generate the upper tiers (QQWing, technique-graded)

```bash
pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded               # appends ~10,000 rows
pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded --dry-run     # generate + report, no writes
pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded --count 50    # 50 per tier (small test)
```

Generates **2,500 each of `medium` / `hard` / `expert` / `killer`** locally with QQWing, graded by QQWing's own difficulty class + technique counts rather than a rating ([DECISIONS.md #0042](../../docs/DECISIONS.md)):

| tier | QQWing class | extra criterion | pure-logic? |
|---|---|---|---|
| medium | EASY | — | yes (`guess_count = 0`) |
| hard | INTERMEDIATE | exactly 1 distinct advanced technique | yes |
| expert | INTERMEDIATE | ≥2 distinct advanced techniques | yes |
| killer (hidden) | EXPERT | `guess_count ≥ 1` | no — requires a guess |

"Advanced techniques" = {naked pair, hidden pair, pointing pair/triple, box-line reduction}. There is **no clue-count augmentation** here — augmentation only eases a puzzle, which would erase the technique grade. Each candidate keeps the same gates (unique solution, solution-match, dedupe by code) and stores QQWing's per-puzzle metadata in the typed columns added by migration 0016 (`qqwing_difficulty`, `clue_count`, `guess_count`, `backtrack_count`, the five technique counts, and `advanced_technique_count`). The `expert` slice (≥2 techniques, ~5% of raw generations) is the throughput bottleneck; the full run is ~15 minutes single-threaded.

> Requires migrations `0016` (metadata columns) and `0017` (clears the old Kaggle rows) to be applied first.

---

## 5. Verify

```bash
pnpm --filter @sudoku-squad/ingest check
```

After a successful ingest, the connectivity check should report a non-zero `puzzles` count, and the anon-role read of `puzzles.solution` should still be denied — that's the real RLS test that wasn't possible while the table was empty.

```bash
pnpm --filter @sudoku-squad/ingest verify:samples
```

Independent sanity check on the small in-repo `apps/web/lib/sample-puzzles.ts` pack, unrelated to the ingest run.

---

## Files

| File | Purpose |
|---|---|
| `src/solver.ts` | Norvig-ported constraint-propagation solver. Used to verify uniqueness. |
| `src/csv.ts` | Tiny streaming CSV reader. Sufficient for Kaggle's uniform sudoku format. |
| `src/code.ts` | Puzzle-code hash (`md5(givens) → 40 bits → mod 36^6 → 6-char base36`). Byte-identical to Postgres' `puzzle_code_for`. Pinned by `code.test.ts`. |
| `src/index.ts` | The Kaggle ingest entrypoint (medium / hard / expert / killer). |
| `src/ingest-qqwing.ts` | Local QQWing generator for the warmup / easy tiers. |
| `src/check-connectivity.ts` | Supabase reachability + RLS sanity (4 checks). |
| `src/verify-samples.ts` | Verifies the in-repo sample pack against the solver AND that the pinned codes still match the algorithm. |
| `fixtures/synthetic.csv` | 5 valid + 2 deliberately-bad rows for the repeatable dry-run regression test (`pnpm ingest:dry-fixture`). |

All scripts run via `tsx` under `pnpm run …`. No transpile step. Tests use Vitest.
