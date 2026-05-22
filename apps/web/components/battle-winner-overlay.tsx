'use client';

import Link from 'next/link';
import type { RoomPlayerProgress } from '@/lib/rooms';

interface Props {
  winnerPlayerId: string | null;
  ownPlayerId: string;
  players: RoomPlayerProgress[];
  onDismiss: () => void;
  /** Returns true if the player can keep solving — i.e. they didn't win. */
  canKeepSolving: boolean;
  dismissed: boolean;
}

/**
 * Per docs/DECISIONS.md #0008, the winner overlay is dismissible and losers
 * can keep solving their own boards. The "Play again" CTA is a no-op
 * placeholder until the create-room-with-same-players flow lands.
 */
export function BattleWinnerOverlay({
  winnerPlayerId,
  ownPlayerId,
  players,
  onDismiss,
  canKeepSolving,
  dismissed,
}: Props) {
  if (winnerPlayerId === null || dismissed) return null;
  const winner = players.find((p) => p.player_id === winnerPlayerId);
  const youWon = winnerPlayerId === ownPlayerId;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Battle finished"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <p
          className="text-sm font-medium uppercase tracking-widest"
          style={{ color: winner?.color ?? '#f59e0b' }}
        >
          {youWon ? 'You won' : `${winner?.username ?? 'Someone'} won`}
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          {youWon ? 'Nicely done.' : 'Better luck next time.'}
        </h2>
        <div className="mt-6 flex flex-col gap-2">
          {canKeepSolving ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Keep solving
            </button>
          ) : null}
          <Link
            href="/"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Back to menu
          </Link>
        </div>
      </div>
    </div>
  );
}
