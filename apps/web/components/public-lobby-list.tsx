'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchPublicLobbies,
  subscribeToPublicLobbies,
  type PublicLobby,
  type RoomMode,
} from '@/lib/rooms';
import { difficultyLabel } from '@/lib/difficulty-labels';
import { GroupsIcon } from '@/components/material-icons';

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
    <section className="flex w-full flex-col gap-2 pt-1">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-widest text-muted">
        <h2 className="inline-flex min-w-0 items-center gap-2">
          <GroupsIcon size={16} className="shrink-0" />
          <span className="truncate">Join multiplayer game</span>
        </h2>
      </div>
      <ul className="flex w-full flex-col gap-2">
        {filtered.map((r) => (
          <li key={r.id}>
            <Link
              href={`/r/${r.code}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-primary-border"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-foreground">
                  {r.host_username}
                </span>
                <span className="text-xs uppercase tracking-widest text-muted">
                  {r.mode} · {difficultyLabel(r.difficulty)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted">Join →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
