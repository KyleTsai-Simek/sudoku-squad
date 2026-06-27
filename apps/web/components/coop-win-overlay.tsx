'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fireWinConfetti } from '@/lib/confetti';
import { returnToLobby, type RoomPlayerProgress } from '@/lib/rooms';
import { ShareResultButton, type ShareResultInput } from './share-result-button';

interface Props {
  roomId: string;
  finished: boolean;
  players: RoomPlayerProgress[];
  dismissed: boolean;
  onDismiss: () => void;
  shareResult?: ShareResultInput;
}

/**
 * Coop shared-win overlay. Mirrors the BattleWinnerOverlay shape but with
 * "Solved together!" copy — there's no individual winner in coop. Same
 * Return-to-lobby flow (per DECISIONS #0030 same-room replay cycle).
 */
export function CoopWinOverlay({ roomId, finished, players, dismissed, onDismiss, shareResult }: Props) {
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const visible = finished && !dismissed;

  useEffect(() => {
    if (visible) fireWinConfetti();
  }, [visible]);

  if (!visible) return null;

  async function onReturn() {
    setReturning(true);
    const res = await returnToLobby(roomId);
    setReturning(false);
    if (res.ok) onDismiss();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coop finished"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-2xl">
        <p className="text-sm font-medium uppercase tracking-widest text-success">
          Solved together!
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Nice work, team.</h2>
        <p className="mt-3 text-sm text-muted">
          {players.length === 1
            ? 'You finished the puzzle.'
            : `${players.length} players finished the puzzle.`}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {shareResult ? <ShareResultButton result={shareResult} /> : null}
          <button
            type="button"
            onClick={onReturn}
            disabled={returning}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {returning ? 'Returning…' : 'Return to lobby'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-muted"
          >
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}
