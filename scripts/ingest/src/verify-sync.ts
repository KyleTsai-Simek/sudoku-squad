/**
 * One-off verifier: confirm the multiplayer-sync schema (migrations 0014 +
 * 0015) and the matching RPCs are live on the linked project.
 *
 * Checks:
 *   1. rooms.next_seq column exists.
 *   2. moves.client_move_id column exists.
 *   3. reserve_room_seq RPC (single-seq reservation) is callable.
 *   4. reserve_room_seqs RPC (batch reservation) is callable.
 *
 * Run with `pnpm --filter @sudoku-squad/ingest verify:sync`.
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local at the
 * repo root (the existing ingest scripts do the same).
 */

import { createClient } from '@supabase/supabase-js';

// Env is loaded by `tsx -r dotenv/config dotenv_config_path=../../.env.local`
// per the `verify:0014` script in package.json — same pattern as the other
// connectivity / audit scripts in this package.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

const checks: Check[] = [
  {
    name: 'rooms.next_seq column exists',
    run: async () => {
      // PostgREST 400s if the column doesn't exist; a clean response (even
      // with zero rows) proves the column is there.
      const probe = await admin.from('rooms').select('id, next_seq').limit(1);
      if (probe.error) {
        return { ok: false, detail: probe.error.message };
      }
      return { ok: true, detail: `selectable; sample rows: ${probe.data?.length ?? 0}` };
    },
  },
  {
    name: 'moves.client_move_id column exists',
    run: async () => {
      const probe = await admin.from('moves').select('id, client_move_id').limit(1);
      if (probe.error) {
        return { ok: false, detail: probe.error.message };
      }
      return { ok: true, detail: `selectable; sample rows: ${probe.data?.length ?? 0}` };
    },
  },
  {
    name: 'reserve_room_seq RPC callable (and returns null for unknown room)',
    run: async () => {
      const fakeRoom = '00000000-0000-0000-0000-000000000000';
      const { data, error } = await admin.rpc('reserve_room_seq', {
        p_room_id: fakeRoom,
      });
      if (error) {
        return { ok: false, detail: `${error.code ?? ''} ${error.message}` };
      }
      if (data !== null) {
        return {
          ok: false,
          detail: `expected null for nonexistent room, got ${JSON.stringify(data)}`,
        };
      }
      return { ok: true, detail: 'rpc exists; returned null as expected' };
    },
  },
  {
    name: 'reserve_room_seqs (batch) RPC callable',
    run: async () => {
      // Migration 0015 — batch variant. Same null-on-unknown-room contract.
      const fakeRoom = '00000000-0000-0000-0000-000000000000';
      const { data, error } = await admin.rpc('reserve_room_seqs', {
        p_room_id: fakeRoom,
        p_count: 5,
      });
      if (error) {
        return { ok: false, detail: `${error.code ?? ''} ${error.message}` };
      }
      if (data !== null) {
        return {
          ok: false,
          detail: `expected null for nonexistent room, got ${JSON.stringify(data)}`,
        };
      }
      return { ok: true, detail: 'batch rpc exists; returned null as expected' };
    },
  },
];

async function main() {
  let failed = 0;
  for (const c of checks) {
    process.stdout.write(`• ${c.name} ... `);
    const { ok, detail } = await c.run();
    if (ok) {
      console.log(`OK (${detail})`);
    } else {
      failed++;
      console.log(`FAIL — ${detail}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed — migration 0014 is live.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
