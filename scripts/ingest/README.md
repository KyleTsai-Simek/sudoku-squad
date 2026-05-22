# @sudoku-squad/ingest

One-off scripts for ingesting puzzles from a Kaggle Sudoku dataset into Supabase.

**This package is not shipped to clients.** It runs locally, talks to Supabase via the service-role key, and exits. The Norvig solver lives here (not in `packages/core`) because it's only needed at ingest time. Per [docs/DECISIONS.md #0012](../../docs/DECISIONS.md).

---

## 1. Get the dataset

We target the [1 Million Sudoku Games](https://www.kaggle.com/datasets/bryanpark/sudoku) dataset by default (~150 MB after extract). The 9M variant ([rohanrao/sudoku](https://www.kaggle.com/datasets/rohanrao/sudoku)) also works — the script auto-detects the column layout.

### With the Kaggle CLI

```bash
# One-time setup
pip install kaggle
# Drop your kaggle.json (from https://www.kaggle.com/settings → API → Create New Token)
# into ~/.kaggle/kaggle.json and chmod 600 it.

# From the repo root:
mkdir -p scripts/ingest/data
cd scripts/ingest/data
kaggle datasets download -d bryanpark/sudoku
unzip sudoku.zip
# (Or 9M:  kaggle datasets download -d rohanrao/sudoku )
```

You should end up with a `.csv` file inside `scripts/ingest/data/`. The directory is gitignored — the file never lands in version control.

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

## 3. Run the ingest

```bash
# From repo root
pnpm --filter @sudoku-squad/ingest ingest
```

What it does:

1. Finds the largest `.csv` under `scripts/ingest/data/`.
2. Streams rows, parsing the puzzle/solution columns (header names auto-detected — handles `puzzle`/`solution`, `quizzes`/`solutions`, etc.).
3. Buckets each row into one of four tiers:
   - **From a `difficulty`/`level`/`rating` column** if the dataset has one.
   - **Otherwise from clue count**: `easy` ≥ 36 clues, `medium` 30–35, `hard` 26–29, `expert` ≤ 25.
4. Runs the Norvig solver on every kept candidate to verify it has a unique solution *and* that the solution matches what the dataset claims.
5. Stops once each tier hits its target (default **2500 each, 10000 total**).
6. Inserts the sampled rows into the Supabase `puzzles` table in batches of 250.

Targets and batch size are constants at the top of [src/index.ts](src/index.ts) — edit and re-run if you want a different size mix.

The script appends. If you want a clean slate, truncate `public.puzzles` in the Supabase SQL editor first. (Note: this also requires no rows in `public.rooms`, which references `puzzles.id`.)

---

## 4. Verify

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
| `src/index.ts` | The ingest entrypoint described above. |
| `src/check-connectivity.ts` | Supabase reachability + RLS sanity. |
| `src/verify-samples.ts` | Verifies the in-repo sample pack against the solver. |

All four scripts run via `tsx` under `pnpm run …`. No transpile step.
