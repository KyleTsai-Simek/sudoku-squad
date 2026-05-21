/**
 * Ingestion entrypoint.
 *
 * Reads the Kaggle 9M Sudoku CSV, verifies each puzzle has a unique solution
 * (per DECISIONS.md #0011 and #0012), and upserts a sampled subset into Supabase.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest ingest`
 *
 * Requires env vars (see .env.example at repo root):
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY  (server-only; never use the anon key here)
 */

import 'dotenv/config';

async function main(): Promise<void> {
  // TODO (Phase 1):
  //  1. Locate or download the Kaggle 9M dataset to scripts/ingest/data/.
  //  2. Stream-parse the CSV row by row.
  //  3. For each row: parse `puzzle` (81 chars) and `solution` (81 chars).
  //  4. Run hasUniqueSolution(puzzle); reject if not unique.
  //  5. Verify solve(puzzle) matches solution; reject if mismatch.
  //  6. Sample N rows per difficulty.
  //  7. Insert into Supabase `puzzles` table via service_role client.
  console.log('ingest: placeholder. Implement in Phase 1 — see scripts/ingest/README.md.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
