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
  {
    const { data, error } = await anon.from('puzzles_public').select('id').limit(1);
    if (error) {
      if (error.message.includes('relation') || error.code === '42P01') {
        fail('puzzles_public view not found. Did you apply supabase/migrations/0001_initial.sql?');
        process.exit(1);
      }
      fail(`Unexpected error reading puzzles_public: ${error.message}`);
      process.exit(1);
    }
    ok(`Anon client connected. puzzles_public returned ${data?.length ?? 0} row(s).`);
  }

  // 3. Anon must NOT be able to read the underlying puzzles table (which contains `solution`).
  {
    const { data, error } = await anon.from('puzzles').select('solution').limit(1);
    if (error) {
      ok(`Anon correctly blocked from puzzles.solution (${error.code ?? 'denied'}).`);
    } else if (data && data.length > 0) {
      fail('SECURITY: anon was able to read puzzles.solution. RLS is wrong.');
      process.exit(2);
    } else {
      // No error and empty array — depending on Supabase config this can happen when the table
      // is empty AND RLS denies; either way, we should ensure RLS is in fact enabled.
      warn('Anon got an empty response (no rows) from puzzles. Verify the table is empty AND RLS is enabled.');
    }
  }

  // 4. Service role can read puzzles
  {
    const { error, count } = await admin.from('puzzles').select('*', { count: 'exact', head: true });
    if (error) {
      fail(`Service role cannot read puzzles: ${error.message}`);
      process.exit(1);
    }
    ok(`Service role connected. puzzles table has ${count ?? 0} row(s).`);
  }

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
