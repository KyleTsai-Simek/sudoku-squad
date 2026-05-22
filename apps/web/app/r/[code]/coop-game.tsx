'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useCoopStore } from '@/lib/coop-store';
import {
  fetchAllMoves,
  fetchPuzzleGivens,
  subscribeToMoves,
  type RoomPlayerProgress,
  type RoomSettings,
  type RoomState,
} from '@/lib/rooms';
import { CoopBoard } from '@/components/coop-board';
import { CoopNumberPad } from '@/components/coop-number-pad';
import { CoopKeyboardController } from '@/components/coop-keyboard';
import { CoopWinOverlay } from '@/components/coop-win-overlay';
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
  /** Non-null means rooms.status='finished'. Coop never has a single winner;
   *  the room row's winner_player_id stays NULL and the win is shared. */
  finished: boolean;
}

export function CoopGame({ room, players, settings, serverStartedAt, finished }: Props) {
  const board = useCoopStore((s) => s.board);
  const startedAt = useCoopStore((s) => s.startedAt);
  const finishedAt = useCoopStore((s) => s.finishedAt);
  const sharedProgressPct = useCoopStore((s) => s.sharedProgressPct);
  const startCoop = useCoopStore((s) => s.startCoop);
  const applySettings = useCoopStore((s) => s.applySettings);
  const applyRemoteMove = useCoopStore((s) => s.applyRemoteMove);
  const markFinished = useCoopStore((s) => s.markFinished);
  const [winDismissed, setWinDismissed] = useState(false);

  const gameStartsAt = useMemo(() => {
    if (!serverStartedAt) return null;
    return new Date(serverStartedAt).getTime() + COUNTDOWN_MS;
  }, [serverStartedAt]);

  // Initialize: fetch givens + full move log, fold into board, subscribe.
  useEffect(() => {
    if (board && board.puzzleCode === room.puzzle_code) return;
    if (gameStartsAt === null) return;
    let cancelled = false;
    (async () => {
      const [p, moves] = await Promise.all([
        fetchPuzzleGivens(room.puzzle_code),
        fetchAllMoves(room.room_id),
      ]);
      if (cancelled || !p) return;
      startCoop(room, room.puzzle_code, p.givens, settings, gameStartsAt, moves);
    })();
    return () => {
      cancelled = true;
    };
  }, [room, board, startCoop, settings, gameStartsAt]);

  // Realtime: fold in every new move from the room into the local board.
  // The store's pendingOwnSeqs dedupes our own echoes.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const off = await subscribeToMoves(room.room_id, applyRemoteMove);
      if (cancelled) {
        off();
        return;
      }
      cleanup = off;
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [room.room_id, applyRemoteMove]);

  // Mirror server-side settings changes (shouldn't happen mid-game; defensive).
  useEffect(() => {
    applySettings(settings);
  }, [settings, applySettings]);

  // Server says the room is finished → lock the local board for everyone.
  useEffect(() => {
    if (finished) markFinished();
  }, [finished, markFinished]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null || finishedAt !== null) return;
    const h = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(h);
  }, [startedAt, finishedAt]);

  const inCountdown = startedAt !== null && now < startedAt;
  const countdownSeconds = inCountdown ? Math.max(1, Math.ceil((startedAt - now) / 1000)) : 0;
  const elapsed = useMemo(() => {
    if (startedAt === null) return 0;
    return Math.max(0, now - startedAt);
  }, [now, startedAt]);

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
          <span className="text-xs uppercase tracking-widest text-stone-500">coop</span>
          <KeyboardShortcutsButton />
        </div>
      </header>

      {/* Shared progress bar across the top of the board. One bar for the
          whole team rather than per-player rows. */}
      <div className="w-full max-w-[min(92vw,560px)] text-xs text-stone-600">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">
            Team progress · {players.length} player{players.length === 1 ? '' : 's'}
          </span>
          <span className="tabular-nums">{sharedProgressPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, sharedProgressPct))}%` }}
          />
        </div>
      </div>

      {board ? (
        <div className="relative flex w-full flex-col items-center gap-4">
          <CoopBoard />
          <CoopNumberPad />
          <CoopKeyboardController />
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

      <CoopWinOverlay
        roomId={room.room_id}
        finished={finished}
        players={players}
        dismissed={winDismissed}
        onDismiss={() => setWinDismissed(true)}
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
