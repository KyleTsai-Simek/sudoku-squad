'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useBattleStore } from '@/lib/battle-store';
import {
  fetchPuzzleGivens,
  type RoomPlayerProgress,
  type RoomSettings,
  type RoomState,
} from '@/lib/rooms';
import { BattleBoard } from '@/components/battle-board';
import { BattleNumberPad } from '@/components/battle-number-pad';
import { BattleKeyboardController } from '@/components/battle-keyboard';
import { OpponentProgress } from '@/components/opponent-progress';
import { BattleWinnerOverlay } from '@/components/battle-winner-overlay';
import {
  KeyboardShortcutsButton,
  KeyboardShortcutsOverlay,
} from '@/components/keyboard-shortcuts-overlay';

const COUNTDOWN_MS = 5000;

interface Props {
  room: RoomState;
  players: RoomPlayerProgress[];
  settings: RoomSettings;
  serverStartedAt: string | null;
  winnerPlayerId: string | null;
}

export function BattleGame({
  room,
  players,
  settings,
  serverStartedAt,
  winnerPlayerId,
}: Props) {
  const board = useBattleStore((s) => s.board);
  const startedAt = useBattleStore((s) => s.startedAt);
  const ownProgressPct = useBattleStore((s) => s.ownProgressPct);
  const startBattle = useBattleStore((s) => s.startBattle);
  const applySettings = useBattleStore((s) => s.applySettings);
  const markFinished = useBattleStore((s) => s.markFinished);
  const [winnerDismissed, setWinnerDismissed] = useState(false);

  // The absolute moment input unlocks = server-stamped started_at + 5s.
  // Clients with even modest clock drift agree on this within a second.
  const gameStartsAt = useMemo(() => {
    if (!serverStartedAt) return null;
    return new Date(serverStartedAt).getTime() + COUNTDOWN_MS;
  }, [serverStartedAt]);

  // Initialize the battle store when we first land here.
  useEffect(() => {
    if (board && board.puzzleCode === room.puzzle_code) return;
    if (gameStartsAt === null) return; // wait until lobby gives us started_at
    let cancelled = false;
    (async () => {
      const p = await fetchPuzzleGivens(room.puzzle_code);
      if (cancelled || !p) return;
      startBattle(room, room.puzzle_code, p.givens, settings, gameStartsAt);
    })();
    return () => {
      cancelled = true;
    };
  }, [room, board, startBattle, settings, gameStartsAt]);

  // Settings shouldn't change once status='playing' (server refuses) but
  // mirror any update defensively so we never drift.
  useEffect(() => {
    applySettings(settings);
  }, [settings, applySettings]);

  // Mirror server-side "the room is now finished" into local store so the
  // board disables. The overlay reads winnerPlayerId from props.
  useEffect(() => {
    if (winnerPlayerId !== null) markFinished();
  }, [winnerPlayerId, markFinished]);

  // Ticker for elapsed-time + countdown display.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null || winnerPlayerId !== null) return;
    const h = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(h);
  }, [startedAt, winnerPlayerId]);

  const inCountdown = startedAt !== null && now < startedAt;
  const countdownSeconds = inCountdown
    ? Math.max(1, Math.ceil((startedAt - now) / 1000))
    : 0;

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
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-stone-500">battle</span>
          <KeyboardShortcutsButton />
        </div>
      </header>

      <OpponentProgress
        players={players}
        ownPlayerId={room.own_player_id}
        ownProgressPct={ownProgressPct}
      />

      {board ? (
        <div className="relative flex w-full flex-col items-center gap-4">
          <BattleBoard />
          <BattleNumberPad />
          <BattleKeyboardController />
          <KeyboardShortcutsOverlay />
          {inCountdown ? (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-white/70 backdrop-blur-sm"
            >
              <p className="text-xs font-medium uppercase tracking-widest text-stone-500">
                Game starts in
              </p>
              <p className="text-7xl font-semibold tabular-nums text-stone-900">
                {countdownSeconds}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex h-[60vh] items-center justify-center text-stone-500">
          Loading puzzle…
        </div>
      )}

      <BattleWinnerOverlay
        roomId={room.room_id}
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
