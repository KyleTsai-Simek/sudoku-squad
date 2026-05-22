'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fireWinConfetti } from '@/lib/confetti';
import { returnToLobby, type RoomPlayerProgress } from '@/lib/rooms';

interface Props {
  roomId: string;
  winnerPlayerId: string | null;
  ownPlayerId: string;
  players: RoomPlayerProgress[];
  onDismiss: () => void;
  /** True if the player can keep solving (they didn't win). */
  canKeepSolving: boolean;
  dismissed: boolean;
}

export function BattleWinnerOverlay({
  roomId,
  winnerPlayerId,
  ownPlayerId,
  players,
  onDismiss,
  canKeepSolving,
  dismissed,
}: Props) {
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const visible = winnerPlayerId !== null && !dismissed;

  useEffect(() => {
    if (visible) fireWinConfetti();
  }, [visible]);

  if (!visible) return null;
  const winner = players.find((p) => p.player_id === winnerPlayerId);
  const youWon = winnerPlayerId === ownPlayerId;

  async function onReturn() {
    setReturning(true);
    const res = await returnToLobby(roomId);
    setReturning(false);
    if (res.ok) {
      // We're back in the lobby; the parent's room subscription will re-route.
      onDismiss();
    }
  }

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
          {youWon ? 'You won!' : `${winner?.username ?? 'Someone'} won`}
        </p>
        {youWon ? (
          <h2 className="mt-2 text-2xl font-semibold">Nicely done.</h2>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onReturn}
            disabled={returning}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {returning ? 'Returning…' : 'Return to lobby'}
          </button>
          {canKeepSolving ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Keep solving
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}
