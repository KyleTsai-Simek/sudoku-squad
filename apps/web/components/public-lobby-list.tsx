'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchPublicLobbies,
  subscribeToPublicLobbies,
  type PublicLobby,
} from '@/lib/rooms';

/**
 * Compact card list of open public rooms, used on the home page. Auto-refreshes
 * on any `rooms` realtime event — we filter client-side for is_public + status.
 */
export function PublicLobbyList() {
  const [rooms, setRooms] = useState<PublicLobby[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const list = await fetchPublicLobbies();
      if (!cancelled) setRooms(list);
    }
    let unsub: (() => void) | null = null;
    (async () => {
      await refresh();
      if (cancelled) return;
      unsub = await subscribeToPublicLobbies(refresh);
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  if (rooms === null) return null; // still loading; skip the section silently
  if (rooms.length === 0) return null;

  return (
    <section className="w-full">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
        Public lobbies
      </h2>
      <ul className="flex flex-col gap-2">
        {rooms.map((r) => (
          <li key={r.id}>
            <Link
              href={`/r/${r.code}`}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm hover:border-stone-400"
            >
              <span className="flex items-center gap-3">
                <span className="font-mono font-semibold tracking-widest text-stone-900">
                  {r.code}
                </span>
                <span className="text-xs uppercase tracking-widest text-stone-500">
                  {r.mode} · {r.status}
                </span>
              </span>
              <span className="text-xs text-stone-400">Join →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
