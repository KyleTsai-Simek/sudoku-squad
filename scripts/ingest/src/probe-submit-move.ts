/**
 * Probe whether the DEPLOYED submit-move Edge Function understands the
 * batch shape `{ room_id, moves: [...] }`.
 *
 * We hit the function with a syntactically-valid batch request against a
 * nonexistent room. The new function should respond with `not_found`
 * (room not found), since it accepts the batch and gets all the way to
 * the room lookup. The OLD function will respond with `bad_request`
 * because its parser expects top-level `cell`/`kind`.
 *
 * This lets us tell the deployed version apart without inspecting the
 * function's source.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Sign in anonymously so we have a JWT (the function rejects unauthenticated).
  const { error: signErr } = await client.auth.signInAnonymously();
  if (signErr) {
    console.error('signInAnonymously failed:', signErr.message);
    process.exit(1);
  }

  const fakeRoom = '00000000-0000-0000-0000-000000000000';
  const batchBody = {
    room_id: fakeRoom,
    moves: [
      { cell: 0, kind: 'value', value: 5, client_move_id: 'probe-' + Date.now() },
    ],
  };

  console.log('Probing batch shape against deployed submit-move...');
  // Direct fetch so we can read the body regardless of HTTP status.
  const { data: session } = await client.auth.getSession();
  const token = session.session?.access_token;
  if (!token) {
    console.error('No JWT after signInAnonymously — aborting');
    process.exit(1);
  }
  const res = await fetch(`${url}/functions/v1/submit-move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: anon!,
    },
    body: JSON.stringify(batchBody),
  });
  const body = await res.text();
  console.log(`  HTTP ${res.status}: ${body}`);
  try {
    const parsed = JSON.parse(body);
    const code = parsed?.error?.code;
    if (code === 'not_found') {
      console.log('  → New batched function is deployed. Code path reached the room lookup.');
    } else if (code === 'bad_request') {
      console.log('  → OLD function still deployed. It rejected the batch shape as malformed.');
      console.log('  → Fix: `supabase functions deploy submit-move`');
    } else if (code === 'forbidden') {
      console.log('  → New function deployed (got past room lookup, but room is fake → forbidden is also possible).');
    } else {
      console.log(`  → response code: ${code ?? '<none>'}`);
    }
  } catch {
    console.log('  → response is not JSON; raw body above');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
