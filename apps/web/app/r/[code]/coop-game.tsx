'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Difficulty } from '@sudoku-squad/core';
import { useCoopStore, computeOwnership } from '@/lib/coop-store';
import { playerColorStyle } from '@/lib/player-colors';
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
import { AppHeader } from '@/components/app-header';
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
  serverFinishedAt: string | null;
  difficulty: Difficulty | null;
  /** Non-null means rooms.status='finished'. Coop never has a single winner;
   *  the room row's winner_player_id stays NULL and the win is shared. */
  finished: boolean;
}

export function CoopGame({
  room,
  players,
  settings,
  serverStartedAt,
  serverFinishedAt,
  difficulty,
  finished,
}: Props) {
  const board = useCoopStore((s) => s.board);
  const givens = useCoopStore((s) => s.givens);
  const startedAt = useCoopStore((s) => s.startedAt);
  const finishedAt = useCoopStore((s) => s.finishedAt);
  const sharedProgressPct = useCoopStore((s) => s.sharedProgressPct);
  const serverMoves = useCoopStore((s) => s.serverMoves);
  const pendings = useCoopStore((s) => s.pendings);
  const startCoop = useCoopStore((s) => s.startCoop);
  const applySettings = useCoopStore((s) => s.applySettings);
  const applyRemoteMove = useCoopStore((s) => s.applyRemoteMove);
  const markFinished = useCoopStore((s) => s.markFinished);
  const resync = useCoopStore((s) => s.resync);
  // Derive per-player credit at render time from server-confirmed moves
  // overlaid with our own pendings. This sidesteps having to keep an
  // ownership map in sync across every store transition and ensures the
  // bar updates the instant a pending move is queued (no realtime echo
  // wait — same UX guarantee as the optimistic board overlay).
  const cellOwnership = useMemo(
    () => computeOwnership(serverMoves, pendings, room.own_player_id),
    [serverMoves, pendings, room.own_player_id],
  );
  const [winDismissed, setWinDismissed] = useState(false);

  const gameStartsAt = useMemo(() => {
    if (!serverStartedAt) return null;
    return new Date(serverStartedAt).getTime() + COUNTDOWN_MS;
  }, [serverStartedAt]);

  // Subscribe to the moves channel once per room — held across re-renders
  // so any parent re-render (player joins, settings update) doesn't tear
  // it down. Events arriving before startCoop runs go into the store's
  // pendingRemote buffer and get drained in seq order then. On reconnect
  // (transient network drops), refetch the move log — postgres_changes
  // doesn't replay missed events from the offline window.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const off = await subscribeToMoves(room.room_id, applyRemoteMove, () => {
        void resync();
      });
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
  }, [room.room_id, applyRemoteMove, resync]);

  // Visibility-change resync: a backgrounded tab can miss realtime events
  // (browsers throttle WebSockets in background tabs, and postgres_changes
  // doesn't replay). Refetch on return-to-visible.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [resync]);

  // One-shot init: fetch givens + the existing move log, then hand off to
  // startCoop. Guarded by `board.puzzleCode === room.puzzle_code` so a
  // re-render with the same puzzle is a no-op; a puzzle_code change
  // (round-replay) re-initializes.
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

  const shareResult = useMemo(() => {
    if (!difficulty || startedAt === null || !finished) return undefined;
    const serverEnd = serverFinishedAt ? new Date(serverFinishedAt).getTime() : null;
    const localEnd = finishedAt ?? now;
    const solveTimeMs = Math.max(0, (serverEnd ?? localEnd) - startedAt);
    return {
      puzzleCode: room.puzzle_code,
      difficulty,
      solveTimeMs,
      mode: 'coop' as const,
      roomCode: room.room_code,
      playerCount: players.length,
    };
  }, [difficulty, finished, finishedAt, now, players.length, room.puzzle_code, room.room_code, serverFinishedAt, startedAt]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-4 px-3 py-4">
      <AppHeader
        left={
          <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
            ← Menu
          </Link>
        }
        center={
          <span className="text-xs uppercase tracking-widest text-muted">co-op</span>
        }
        actions={
          <KeyboardShortcutsButton />
        }
      />

      <span aria-label="Elapsed time" className="font-mono tabular-nums text-muted">
        {formatElapsed(elapsed)}
      </span>

      <div className="flex w-full max-w-[min(92vw,560px)] flex-col gap-2">
        <CoopPlayerNames players={players} cellOwnership={cellOwnership} />
        <CoopProgress
          players={players}
          cellOwnership={cellOwnership}
          givens={givens}
          sharedProgressPct={sharedProgressPct}
        />
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
              className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-surface/80 backdrop-blur-sm"
            >
              <p className="text-xs font-medium uppercase tracking-widest text-muted">
                Game starts in
              </p>
              <p className="text-7xl font-semibold tabular-nums text-foreground">
                {countdownSeconds}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex h-[60vh] items-center justify-center text-muted">
          Loading puzzle…
        </div>
      )}

      <CoopWinOverlay
        roomId={room.room_id}
        finished={finished}
        players={players}
        dismissed={winDismissed}
        shareResult={shareResult}
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

/**
 * Row of player names colored by lobby color, above the progress bar.
 * Names flow horizontally and wrap whole-name to the next line when they
 * don't fit (never broken mid-word). Players who haven't placed any cells
 * yet still appear, just with no count chip.
 */
function CoopPlayerNames({
  players,
  cellOwnership,
}: {
  players: RoomPlayerProgress[];
  cellOwnership: Map<string, number>;
}) {
  if (players.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {players.map((p) => {
        const count = cellOwnership.get(p.player_id) ?? 0;
        return (
          <li key={p.player_id} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={playerColorStyle(p.color, 'backgroundColor')}
            />
            <span className="font-semibold" style={playerColorStyle(p.color, 'color')}>
              {p.username}
            </span>
            {count > 0 ? (
              <span className="tabular-nums text-muted">· {count}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Stacked progress bar: each player gets a colored segment proportional to
 * cells they last placed in. Sum of segment widths == sharedProgressPct
 * (off by ≤1pp due to rounding; the server's progressPct is the trusted
 * "official" number shown at the right end).
 *
 * Ownership rule (DECISIONS pending): credit goes to the LAST player to
 * place a value in a cell, regardless of correctness. Overwriting a peer's
 * cell transfers credit. Clearing removes credit. See computeOwnership in
 * coop-store.ts.
 */
function CoopProgress({
  players,
  cellOwnership,
  givens,
  sharedProgressPct,
}: {
  players: RoomPlayerProgress[];
  cellOwnership: Map<string, number>;
  givens: number[] | null;
  sharedProgressPct: number;
}) {
  const totalEmpty = givens ? givens.filter((g) => g === 0).length : 81;
  // Stable order = lobby player order so colors don't shuffle as counts change.
  const segments = players
    .map((p) => ({
      player_id: p.player_id,
      colorStyle: playerColorStyle(p.color, 'backgroundColor'),
      count: cellOwnership.get(p.player_id) ?? 0,
    }))
    .filter((s) => s.count > 0);
  return (
    <div className="text-xs text-muted">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">
          Team progress · {players.length} player{players.length === 1 ? '' : 's'}
        </span>
        <span className="tabular-nums">{sharedProgressPct}%</span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-border">
        {segments.map((s) => (
          <span
            key={s.player_id}
            className="h-full transition-all"
            style={{
              width: `${(s.count / Math.max(1, totalEmpty)) * 100}%`,
              ...s.colorStyle,
            }}
          />
        ))}
      </div>
    </div>
  );
}
