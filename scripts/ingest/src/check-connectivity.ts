/**
 * Connectivity sanity check.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest check`
 *
 * Verifies, in order:
 *  1. The Supabase URL is reachable.
 *  2. The anon key can read `puzzles_public` (the safe view).
 *  3. The anon key is BLOCKED from reading `puzzles.solution` (the actual cheat-prevention check).
 *  4. The service_role key CAN read `puzzles` (so ingest will work).
 *
 * If any of these fail, the message tells you what to fix.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ok(msg: string) {
  console.log(`[32m✓[0m ${msg}`);
}
function fail(msg: string) {
  console.log(`[31m✗[0m ${msg}`);
}
function warn(msg: string) {
  console.log(`[33m![0m ${msg}`);
}

async function main(): Promise<void> {
  if (!url || !anonKey || !serviceKey) {
    fail('Missing env vars. Check .env.local has NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  console.log(`Checking ${url} ...\n`);

  const anon = createClient(url, anonKey);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. URL reachable + 2. anon can read puzzles_public
  let anonViewCount = 0;
  {
    const { data, error } = await anon
      .from('puzzles_public')
      .select('id', { count: 'exact' });
    if (error) {
      if (error.message.includes('relation') || error.code === '42P01') {
        fail('puzzles_public view not found. Did you apply supabase/migrations/0001_initial.sql?');
        process.exit(1);
      }
      fail(`Unexpected error reading puzzles_public: ${error.message}`);
      process.exit(1);
    }
    anonViewCount = data?.length ?? 0;
    ok(`Anon client connected. puzzles_public returned ${anonViewCount} row(s).`);
  }

  // 3. Service role can read puzzles (gets the ground-truth row count).
  let trueCount = 0;
  {
    const { error, count } = await admin.from('puzzles').select('*', { count: 'exact', head: true });
    if (error) {
      fail(`Service role cannot read puzzles: ${error.message}`);
      process.exit(1);
    }
    trueCount = count ?? 0;
    ok(`Service role connected. puzzles table has ${trueCount} row(s).`);
  }

  // 4. Anon must NOT be able to read the underlying puzzles table (which contains `solution`).
  // Now that we have ground-truth row count, this is a real test: if the table has rows but
  // anon sees zero, RLS is doing its job. Empty table makes the check inconclusive.
  {
    const { data, error } = await anon.from('puzzles').select('solution').limit(1);
    if (error) {
      ok(`Anon correctly blocked from puzzles.solution (${error.code ?? 'denied'}).`);
    } else if (data && data.length > 0) {
      fail('SECURITY: anon was able to read puzzles.solution. RLS is wrong.');
      process.exit(2);
    } else if (trueCount > 0) {
      ok(`Anon correctly got 0 rows from puzzles despite ${trueCount} real rows (RLS deny).`);
    } else {
      warn('Anon got 0 rows from puzzles, but the table is also empty — this is inconclusive. Re-run after ingest.');
    }
  }

  // 5. anon's puzzles_public view must NOT expose the `solution` column.
  {
    const { data, error } = await anon
      .from('puzzles_public')
      // PostgREST: requesting a column not in the view returns a 400-ish error.
      .select('solution')
      .limit(1);
    if (error) {
      ok(`Anon correctly cannot select \`solution\` from puzzles_public (${error.code ?? 'denied'}).`);
    } else if (data && data.length > 0 && Object.prototype.hasOwnProperty.call(data[0], 'solution')) {
      fail('SECURITY: puzzles_public exposes the solution column.');
      process.exit(2);
    } else {
      ok('puzzles_public does not expose solution.');
    }
  }

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
