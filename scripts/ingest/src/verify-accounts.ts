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
 *   6. Generated saved-account sessions can rename.
 *   7. Username collisions get discriminators.
 *   8. Changing away frees the previous bare username.
 *   9. merge-progress unions anonymous completions into a saved account.
 *
 * The script creates temporary auth users, then removes their
 * usernames/completions/auth rows with the service-role client.
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
    if (delUser.error.message.toLowerCase().includes('user not found')) return;
    warn(`cleanup: could not delete auth user ${userId}: ${delUser.error.message}`);
  }
}

async function createSavedAccountSession(
  admin: SupabaseClient,
  email: string,
): Promise<{ client: SupabaseClient; userId: string }> {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data.user) {
    fail(`generateLink failed for ${email}: ${link.error?.message ?? 'no user returned'}`);
  }
  const otp = link.data.properties?.email_otp;
  if (!otp) {
    fail(`generateLink for ${email} did not return an email_otp`);
  }
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({ email, token: otp, type: 'email' });
  if (verified.error || !verified.data.user) {
    fail(`verifyOtp failed for generated saved account ${email}: ${verified.error?.message ?? 'no user'}`);
  }
  if (verified.data.user.is_anonymous) {
    fail(`generated saved account ${email} verified as anonymous`);
  }
  return { client, userId: verified.data.user.id };
}

function readUsernamePayload(data: unknown): { username: string; base: string; discriminator: number | null } {
  if (typeof data !== 'object' || data === null) {
    fail(`unexpected set-username payload: ${JSON.stringify(data)}`);
  }
  const record = data as Record<string, unknown>;
  if (typeof record.username !== 'string' || typeof record.base !== 'string') {
    fail(`unexpected set-username payload: ${JSON.stringify(data)}`);
  }
  if (record.discriminator !== null && typeof record.discriminator !== 'number') {
    fail(`unexpected set-username discriminator: ${JSON.stringify(data)}`);
  }
  return {
    username: record.username,
    base: record.base,
    discriminator: record.discriminator,
  };
}

async function setUsername(client: SupabaseClient, username: string): Promise<{ username: string; base: string; discriminator: number | null }> {
  const res = await client.functions.invoke('set-username', { body: { username } });
  if (res.error) {
    fail(`set-username(${username}) failed: ${res.error.message}`);
  }
  return readUsernamePayload(res.data);
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

  const tempUserIds: string[] = [];
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
    tempUserIds.push(tempAnonUserId);
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

    const unique = Date.now().toString(36);
    const accountA = await createSavedAccountSession(admin, `codex-a-${unique}@example.com`);
    const accountB = await createSavedAccountSession(admin, `codex-b-${unique}@example.com`);
    const accountC = await createSavedAccountSession(admin, `codex-c-${unique}@example.com`);
    tempUserIds.push(accountA.userId, accountB.userId, accountC.userId);
    ok('generated saved-account sessions without using an inbox');

    const base = `codex${unique}`.slice(0, 20);
    const firstName = await setUsername(accountA.client, base);
    if (firstName.username !== base || firstName.base !== base || firstName.discriminator !== null) {
      fail(`first username claim should get bare base, got ${JSON.stringify(firstName)}`);
    }
    ok('signed-in user can rename to a free bare base');

    const collisionName = await setUsername(accountB.client, base);
    if (
      collisionName.base !== base ||
      collisionName.discriminator === null ||
      !new RegExp(`^${base}#\\d{4,}$`).test(collisionName.username)
    ) {
      fail(`collision should receive discriminator, got ${JSON.stringify(collisionName)}`);
    }
    ok(`username collision assigned discriminator (${collisionName.username})`);

    await setUsername(accountA.client, `${base}x`.slice(0, 20));
    const reclaimedName = await setUsername(accountC.client, base);
    if (reclaimedName.username !== base || reclaimedName.discriminator !== null) {
      fail(`bare base should be reusable after changing away, got ${JSON.stringify(reclaimedName)}`);
    }
    ok('changing away frees the previous bare username');

    const puzzleCodes = await admin.from('puzzles_public').select('code').limit(2);
    if (puzzleCodes.error || !puzzleCodes.data || puzzleCodes.data.length < 2) {
      fail(`could not fetch puzzle codes for merge test: ${puzzleCodes.error?.message ?? 'not enough rows'}`);
    }
    const [destPuzzle, sourcePuzzle] = puzzleCodes.data.map((row) => row.code);
    const sourceAnon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const sourceSignIn = await sourceAnon.auth.signInAnonymously();
    if (sourceSignIn.error || !sourceSignIn.data.user || !sourceSignIn.data.session) {
      fail(`source anonymous sign-in for merge test failed: ${sourceSignIn.error?.message ?? 'no session'}`);
    }
    const sourceUserId = sourceSignIn.data.user.id;
    tempUserIds.push(sourceUserId);

    const inserted = await admin.from('player_completions').insert([
      { player_id: accountB.userId, puzzle_code: destPuzzle, mode: 'single' },
      { player_id: sourceUserId, puzzle_code: sourcePuzzle, mode: 'single' },
    ]);
    if (inserted.error) {
      fail(`could not seed completions for merge test: ${inserted.error.message}`);
    }
    const merge = await accountB.client.functions.invoke('merge-progress', {
      body: { source_token: sourceSignIn.data.session.access_token },
    });
    if (merge.error) {
      fail(`merge-progress union failed: ${merge.error.message}`);
    }
    const destRows = await admin
      .from('player_completions')
      .select('puzzle_code')
      .eq('player_id', accountB.userId)
      .in('puzzle_code', [destPuzzle, sourcePuzzle]);
    if (destRows.error || (destRows.data?.length ?? 0) !== 2) {
      fail(`merge-progress did not union completions: ${destRows.error?.message ?? JSON.stringify(destRows.data)}`);
    }
    const sourceRows = await admin
      .from('player_completions')
      .select('puzzle_code')
      .eq('player_id', sourceUserId);
    if (sourceRows.error || (sourceRows.data?.length ?? 0) !== 0) {
      fail(`merge-progress did not clear source completions: ${sourceRows.error?.message ?? JSON.stringify(sourceRows.data)}`);
    }
    ok('merge-progress unions anonymous completions into a saved account');

    console.log('\nAll account infrastructure checks passed.');
  } finally {
    const uniqueIds = [...new Set(tempUserIds)];
    for (const userId of uniqueIds) {
      await cleanupAnon(admin, userId);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
