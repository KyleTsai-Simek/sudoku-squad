'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchPublicLobbies,
  subscribeToPublicLobbies,
  type PublicLobby,
  type RoomMode,
} from '@/lib/rooms';

/**
 * Compact card list of open public rooms. Optionally filtered to a specific
 * mode via the `mode` prop (used by the join-mode views in home-client).
 * Without the filter, shows every attended public lobby room. Auto-refreshes
 * on any `rooms` realtime event and polls so last_seen recency can age out.
 *
 * Renders `emptyState` (or hides the section entirely) when the filtered
 * list is empty. The home-page's join view passes a tailored empty state
 * pointing the user at "create your own."
 */
interface Props {
  mode?: RoomMode;
  emptyState?: React.ReactNode;
}

export function PublicLobbyList({ mode, emptyState }: Props) {
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
    const interval = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsub?.();
    };
  }, []);

  if (rooms === null) return null; // still loading
  const filtered = mode ? rooms.filter((r) => r.mode === mode) : rooms;
  if (filtered.length === 0) {
    return emptyState !== undefined ? <>{emptyState}</> : null;
  }

  return (
    <ul className="flex w-full flex-col gap-2">
      {filtered.map((r) => (
        <li key={r.id}>
          <Link
            href={`/r/${r.code}`}
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-primary-border"
          >
            <span className="flex items-center gap-3">
              <span className="font-mono font-semibold tracking-widest text-foreground">
                {r.code}
              </span>
              <span className="text-xs uppercase tracking-widest text-muted">
                {r.mode} · {r.status}
              </span>
            </span>
            <span className="text-xs text-muted">Join →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
