'use client';

import type { RoomPlayerProgress } from '@/lib/rooms';

interface Props {
  players: RoomPlayerProgress[];
  ownPlayerId: string;
  ownProgressPct: number;
}

/**
 * Compact strip showing each player's progress bar. The current player's bar
 * uses their locally-known progress (snappier than waiting for the server
 * echo). Opponents use the cached `progress_pct` on `room_players`, updated
 * by submit-move and broadcast via Realtime.
 */
export function OpponentProgress({ players, ownPlayerId, ownProgressPct }: Props) {
  return (
    <ul className="flex w-full flex-col gap-1">
      {players.map((p) => {
        const pct = p.player_id === ownPlayerId ? ownProgressPct : p.progress_pct;
        const isYou = p.player_id === ownPlayerId;
        return (
          <li
            key={p.player_id}
            className="flex items-center gap-2 text-xs"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <span className="w-24 truncate font-medium text-stone-700">
              {p.username}
              {isYou ? <span className="text-stone-400"> (you)</span> : null}
            </span>
            <span className="flex-1">
              <span
                className="block h-1.5 overflow-hidden rounded-full bg-stone-200"
              >
                <span
                  className="block h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: p.color }}
                />
              </span>
            </span>
            <span className="w-10 text-right tabular-nums text-stone-500">
              {pct}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}
