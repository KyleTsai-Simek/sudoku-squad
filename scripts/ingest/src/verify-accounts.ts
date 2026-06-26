/**
 * Account infrastructure verifier.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest verify:accounts`
 *
 * Covers the parts of Phase 5 saved accounts that can be verified without a
 * human email inbox:
 *   1. Phase 5 schema/RPC exists.
 *   2. Fresh anonymous auth still works.
 *   3. claim-username issues a generated name for anon users.
 *   4. set-username rejects anonymous users.
 *   5. merge-progress rejects invalid source tokens.
 *
 * The script creates a temporary anonymous auth user, then removes its
 * username/completions/auth row with the service-role client.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ok(msg: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function fail(msg: string): never {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
}

function warn(msg: string): void {
  console.log(`\x1b[33m!\x1b[0m ${msg}`);
}

async function cleanupAnon(admin: SupabaseClient, userId: string | null): Promise<void> {
  if (!userId) return;
  const delName = await admin.from('issued_usernames').delete().eq('player_id', userId);
  if (delName.error) {
    warn(`cleanup: could not delete issued_username for ${userId}: ${delName.error.message}`);
  }
  const delCompletions = await admin.from('player_completions').delete().eq('player_id', userId);
  if (delCompletions.error) {
    warn(`cleanup: could not delete completions for ${userId}: ${delCompletions.error.message}`);
  }
  const delUser = await admin.auth.admin.deleteUser(userId);
  if (delUser.error) {
    warn(`cleanup: could not delete auth user ${userId}: ${delUser.error.message}`);
  }
}

async function main(): Promise<void> {
  if (!url || !anonKey || !serviceKey) {
    fail(
      'Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  console.log(`Checking account infrastructure on ${url} ...\n`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let tempAnonUserId: string | null = null;
  try {
    const usernameColumns = await admin
      .from('issued_usernames')
      .select('player_id, username, base, discriminator')
      .limit(1);
    if (usernameColumns.error) {
      fail(`issued_usernames Phase 5 columns missing/unreadable: ${usernameColumns.error.message}`);
    }
    ok('issued_usernames exposes username/base/discriminator columns');

    const stats = await admin.rpc('get_completion_stats');
    if (stats.error) {
      fail(`get_completion_stats RPC failed: ${stats.error.message}`);
    }
    ok('get_completion_stats RPC is callable');

    const signIn = await anon.auth.signInAnonymously();
    if (signIn.error || !signIn.data.user) {
      fail(`anonymous sign-in failed: ${signIn.error?.message ?? 'no user returned'}`);
    }
    tempAnonUserId = signIn.data.user.id;
    ok(`fresh anonymous user created (${tempAnonUserId})`);

    const claim = await anon.functions.invoke('claim-username', { body: {} });
    if (claim.error) {
      fail(`claim-username failed for anonymous user: ${claim.error.message}`);
    }
    const claimedUsername =
      typeof claim.data === 'object' &&
      claim.data !== null &&
      'username' in claim.data &&
      typeof claim.data.username === 'string'
        ? claim.data.username
        : null;
    if (!claimedUsername) {
      fail(`claim-username returned unexpected payload: ${JSON.stringify(claim.data)}`);
    }
    ok(`claim-username issued "${claimedUsername}"`);

    const usernameRow = await admin
      .from('issued_usernames')
      .select('username, base, discriminator')
      .eq('player_id', tempAnonUserId)
      .maybeSingle();
    if (usernameRow.error) {
      fail(`could not read claimed username row: ${usernameRow.error.message}`);
    }
    if (!usernameRow.data?.base || usernameRow.data.username !== claimedUsername) {
      fail(`claimed username row mismatch: ${JSON.stringify(usernameRow.data)}`);
    }
    ok('claimed username row stores generated display name and base');

    const anonRename = await anon.functions.invoke('set-username', {
      body: { username: `codex-${Date.now()}` },
    });
    if (!anonRename.error) {
      fail('set-username unexpectedly allowed an anonymous caller');
    }
    ok('set-username rejects anonymous callers');

    const badMerge = await anon.functions.invoke('merge-progress', {
      body: { source_token: 'not-a-real-token' },
    });
    if (!badMerge.error) {
      fail('merge-progress unexpectedly accepted an anonymous destination / invalid source');
    }
    ok('merge-progress rejects invalid anonymous merge attempts');

    console.log('\nAll account infrastructure checks passed.');
  } finally {
    await cleanupAnon(admin, tempAnonUserId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
