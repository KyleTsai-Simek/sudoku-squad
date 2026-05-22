'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useBattleStore } from '@/lib/battle-store';
import { fetchPuzzleGivens, type RoomPlayerProgress, type RoomState } from '@/lib/rooms';
import { BattleBoard } from '@/components/battle-board';
import { BattleNumberPad } from '@/components/battle-number-pad';
import { BattleKeyboardController } from '@/components/battle-keyboard';
import { OpponentProgress } from '@/components/opponent-progress';
import { BattleWinnerOverlay } from '@/components/battle-winner-overlay';

interface Props {
  room: RoomState;
  players: RoomPlayerProgress[];
  winnerPlayerId: string | null;
}

export function BattleGame({ room, players, winnerPlayerId }: Props) {
  const board = useBattleStore((s) => s.board);
  const startedAt = useBattleStore((s) => s.startedAt);
  const ownProgressPct = useBattleStore((s) => s.ownProgressPct);
  const startBattle = useBattleStore((s) => s.startBattle);
  const markFinished = useBattleStore((s) => s.markFinished);
  const [winnerDismissed, setWinnerDismissed] = useState(false);

  // Initialize the battle store when we first land here.
  useEffect(() => {
    if (board && board.puzzleCode === room.puzzle_code) return;
    let cancelled = false;
    (async () => {
      const p = await fetchPuzzleGivens(room.puzzle_code);
      if (cancelled || !p) return;
      startBattle(room, room.puzzle_code, p.givens);
    })();
    return () => {
      cancelled = true;
    };
  }, [room, board, startBattle]);

  // Mirror server-side "the room is now finished" into local store so the
  // board disables. The overlay reads winnerPlayerId from props.
  useEffect(() => {
    if (winnerPlayerId !== null) markFinished();
  }, [winnerPlayerId, markFinished]);

  // Elapsed-time ticker.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null || winnerPlayerId !== null) return;
    const h = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(h);
  }, [startedAt, winnerPlayerId]);

  const elapsed = useMemo(() => {
    if (startedAt === null) return 0;
    return Math.max(0, now - startedAt);
  }, [now, startedAt]);

  const canKeepSolving = winnerPlayerId !== null && winnerPlayerId !== room.own_player_id;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-4 px-3 py-4">
      <header className="flex w-full items-center justify-between gap-3">
        <Link href="/" className="text-sm font-medium text-stone-600 hover:text-stone-900">
          ← Menu
        </Link>
        <span aria-label="Elapsed time" className="font-mono tabular-nums text-stone-700">
          {formatElapsed(elapsed)}
        </span>
        <span className="text-xs uppercase tracking-widest text-stone-500">battle</span>
      </header>

      <OpponentProgress
        players={players}
        ownPlayerId={room.own_player_id}
        ownProgressPct={ownProgressPct}
      />

      {board ? (
        <>
          <BattleBoard />
          <BattleNumberPad />
          <BattleKeyboardController />
        </>
      ) : (
        <div className="flex h-[60vh] items-center justify-center text-stone-500">
          Loading puzzle…
        </div>
      )}

      <BattleWinnerOverlay
        winnerPlayerId={winnerPlayerId}
        ownPlayerId={room.own_player_id}
        players={players}
        dismissed={winnerDismissed}
        canKeepSolving={canKeepSolving}
        onDismiss={() => setWinnerDismissed(true)}
      />
    </main>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
