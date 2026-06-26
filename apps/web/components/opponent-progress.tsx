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
 *
 * Layout: username column flexes to fit the full name (no truncation); the
 * progress bar takes a fixed slice on the right so even a long username has
 * room. The current player's row is bold (username + %); others are regular,
 * which replaces the older "(you)" label.
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
            <span
              className={
                isYou
                  ? 'min-w-0 flex-1 break-words font-bold text-foreground'
                  : 'min-w-0 flex-1 break-words font-medium text-muted'
              }
            >
              {p.username}
            </span>
            <span className="w-24 shrink-0 sm:w-32">
              <span className="block h-1.5 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, pct))}%`,
                    backgroundColor: p.color,
                  }}
                />
              </span>
            </span>
            <span
              className={
                isYou
                  ? 'w-10 shrink-0 text-right font-bold tabular-nums text-foreground'
                  : 'w-10 shrink-0 text-right tabular-nums text-muted'
              }
            >
              {pct}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}
