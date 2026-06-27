'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  changeDifficulty,
  changeMode,
  confirmRoomPresence,
  fetchPuzzleDifficulty,
  fetchRoom,
  fetchRoomPlayers,
  joinRoom,
  kickPlayer,
  startGame,
  subscribeToRoom,
  subscribeToRoomPlayers,
  type RoomError,
  type RoomMode,
  type RoomPlayerProgress,
  type RoomRow,
  type RoomState,
} from '@/lib/rooms';
import type { Difficulty } from '@sudoku-squad/core';
import { getUsername } from '@/lib/username';
import { AppHeader } from '@/components/app-header';
import { LobbySettingsPanel } from '@/components/lobby-settings-panel';
import { DEFAULT_ROOM_SETTINGS } from '@/lib/rooms';
import { playerColorStyle } from '@/lib/player-colors';
import { difficultyLabel, VISIBLE_DIFFICULTIES } from '@/lib/difficulty-labels';
import { BattleGame } from './battle-game';
import { CoopGame } from './coop-game';

type Phase =
  | { kind: 'joining' }
  | { kind: 'in_lobby'; room: RoomState }
  | { kind: 'error'; error: RoomError };

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const lobbySelectorSelectedClassName = 'border-selected bg-selected text-foreground';
const lobbySelectorIdleClassName =
  'border-primary-muted bg-primary-muted text-foreground hover:border-primary-soft hover:bg-primary-soft';

export function LobbyClient({ code }: { code: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'joining' });
  const [players, setPlayers] = useState<RoomPlayerProgress[]>([]);
  const [roomRow, setRoomRow] = useState<RoomRow | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [currentDifficulty, setCurrentDifficulty] = useState<Difficulty | null>(null);
  // `optimisticDifficulty` reflects the host's click immediately. It clears
  // once the server-driven `currentDifficulty` (resolved from the room's
  // updated puzzle_code) catches up. The selector reads optimistic-first.
  const [optimisticDifficulty, setOptimisticDifficulty] = useState<Difficulty | null>(null);
  // Same pattern for the mode toggle: optimistic first, server confirms.
  const [optimisticMode, setOptimisticMode] = useState<RoomMode | null>(null);
  // Count of in-flight sync writes (difficulty + settings). The Start
  // button disables (with a spinner) while > 0 so users can't race a Start
  // against a pending change. Toggle buttons themselves stay enabled and
  // update immediately.
  const [pendingSync, setPendingSync] = useState(0);

  // 1. Join (or rejoin) the room on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const username = await getUsername();
      const res = await joinRoom({ code, username });
      if (cancelled) return;
      if (res.ok) {
        setPhase({ kind: 'in_lobby', room: res.value });
      } else {
        setPhase({ kind: 'error', error: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // 2. Once joined, fetch initial player + room state, and subscribe.
  useEffect(() => {
    if (phase.kind !== 'in_lobby') return;
    const roomId = phase.room.room_id;
    const ownPlayerId = phase.room.own_player_id;
    let cancelled = false;
    // First fetch returns []  while RLS catches up post-join; we need at least
    // one non-empty list to confirm the caller is in the room before we treat
    // an empty list as a kick.
    let seenSelf = false;

    async function refreshPlayers() {
      const list = await fetchRoomPlayers(roomId);
      if (cancelled) return;
      setPlayers(list);
      const stillIn = list.some((p) => p.player_id === ownPlayerId);
      if (stillIn) {
        seenSelf = true;
      } else if (seenSelf) {
        // We were in the room and now we're not → host kicked us.
        router.push('/?kicked=1');
      }
    }
    async function refreshRoom() {
      const r = await fetchRoom(roomId);
      if (!cancelled) setRoomRow(r);
    }

    function refreshBoth() {
      void refreshPlayers();
      void refreshRoom();
    }

    async function confirmPresence() {
      if (document.visibilityState !== 'visible') return;
      const res = await confirmRoomPresence(roomId);
      if (!res.ok) {
        console.error('confirmRoomPresence failed', res.error);
        return;
      }
      await refreshPlayers();
    }

    let unsubPlayers: (() => void) | null = null;
    let unsubRoom: (() => void) | null = null;
    (async () => {
      await Promise.all([refreshPlayers(), refreshRoom()]);
      if (cancelled) return;
      // On reconnect, postgres_changes does NOT replay events missed while the
      // socket was down — so a dropped channel could otherwise strand us in
      // the lobby (missed status='playing'), hide the winner, or freeze
      // opponent progress. Refetch on every re-subscribe.
      unsubPlayers = await subscribeToRoomPlayers(roomId, refreshPlayers, refreshPlayers);
      unsubRoom = await subscribeToRoom(roomId, refreshRoom, refreshRoom);
    })();

    // Backgrounded tabs throttle WebSockets and miss events; refetch on
    // return-to-visible.
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshBoth();
        void confirmPresence();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    const confirmTimeoutId = window.setTimeout(() => {
      void confirmPresence();
    }, 5000);
    const heartbeatId = window.setInterval(() => {
      void confirmPresence();
    }, 15000);

    // Safety-net poll. Realtime is the primary path; this catches a silently
    // wedged channel that never reports a reconnect (the worst case for "I'm
    // stuck in the lobby while everyone else is playing"). 8s is frequent
    // enough to feel live, cheap enough to ignore.
    const pollId = window.setInterval(refreshBoth, 8000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(confirmTimeoutId);
      window.clearInterval(heartbeatId);
      window.clearInterval(pollId);
      unsubPlayers?.();
      unsubRoom?.();
    };
  }, [phase]);

  // Resolve current difficulty from the room's puzzle_code. Re-runs whenever
  // the room row updates (e.g., host clicks the difficulty toggle and the
  // server picks a new puzzle of the new tier).
  useEffect(() => {
    if (!roomRow?.puzzle_code) {
      setCurrentDifficulty(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const d = await fetchPuzzleDifficulty(roomRow.puzzle_code);
      if (!cancelled) setCurrentDifficulty(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomRow?.puzzle_code]);

  const onChangeDifficulty = useCallback(
    async (next: Difficulty) => {
      if (phase.kind !== 'in_lobby') return;
      // Immediate UI feedback: the button updates now. The realtime room
      // row update will eventually agree (and clear the optimistic flag).
      setOptimisticDifficulty(next);
      setPendingSync((n) => n + 1);
      const res = await changeDifficulty({ room_id: phase.room.room_id, difficulty: next });
      setPendingSync((n) => Math.max(0, n - 1));
      if (!res.ok) {
        // Roll back the optimistic selection on error.
        setOptimisticDifficulty(null);
        setStartError(res.error.message);
      }
    },
    [phase],
  );

  // Clear the optimistic difficulty once the server-resolved value catches
  // up. Runs every time `currentDifficulty` changes.
  useEffect(() => {
    if (optimisticDifficulty !== null && currentDifficulty === optimisticDifficulty) {
      setOptimisticDifficulty(null);
    }
  }, [currentDifficulty, optimisticDifficulty]);

  // Live mode: prefer the server-confirmed roomRow value, fall back to the
  // join-time room snapshot. Optimistic overrides win for instant feedback.
  const phaseRoomMode = phase.kind === 'in_lobby' ? phase.room.mode : null;
  const liveMode: RoomMode =
    optimisticMode ?? roomRow?.mode ?? phaseRoomMode ?? 'battle';

  // Clear the optimistic mode once the server confirms.
  useEffect(() => {
    if (optimisticMode !== null && roomRow?.mode === optimisticMode) {
      setOptimisticMode(null);
    }
  }, [roomRow?.mode, optimisticMode]);

  const onChangeMode = useCallback(
    async (next: RoomMode) => {
      if (phase.kind !== 'in_lobby') return;
      setOptimisticMode(next);
      setPendingSync((n) => n + 1);
      const res = await changeMode({ room_id: phase.room.room_id, mode: next });
      setPendingSync((n) => Math.max(0, n - 1));
      if (!res.ok) {
        setOptimisticMode(null);
        setStartError(res.error.message);
      }
    },
    [phase],
  );

  const onCopyShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1500);
    } catch {
      // ignore
    }
  }, []);

  const onStart = useCallback(async () => {
    if (phase.kind !== 'in_lobby') return;
    setStartPending(true);
    setStartError(null);
    const res = await startGame(phase.room.room_id);
    setStartPending(false);
    if (!res.ok) setStartError(res.error.message);
  }, [phase]);

  // Build the live room reference for the gameplay handoff. Done here, BEFORE
  // any conditional early-return, so the useMemo hook order is stable across
  // renders regardless of phase. See the comment at the use site below for
  // why this is necessary.
  const phaseRoom = phase.kind === 'in_lobby' ? phase.room : null;
  const livePuzzleCode = roomRow?.puzzle_code ?? phaseRoom?.puzzle_code ?? '';
  const liveStatusRaw = roomRow?.status ?? phaseRoom?.status ?? 'lobby';
  // liveRoom carries the most-current puzzle, status, AND mode through to
  // the game surfaces. Without the mode merge, a host who flips mode in the
  // lobby and then starts would still hand the join-time mode to BattleGame
  // / CoopGame and the wrong surface would render.
  const liveRoom = useMemo<RoomState | null>(
    () =>
      phaseRoom
        ? {
            ...phaseRoom,
            puzzle_code: livePuzzleCode,
            status: liveStatusRaw,
            mode: roomRow?.mode ?? phaseRoom.mode,
          }
        : null,
    [phaseRoom, livePuzzleCode, liveStatusRaw, roomRow?.mode],
  );

  if (phase.kind === 'joining') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12 text-muted">
        Joining room…
      </main>
    );
  }

  if (phase.kind === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-danger">
          {phase.error.code.replace(/_/g, ' ')}
        </p>
        <h1 className="text-2xl font-semibold">{lobbyErrorHeadline(phase.error.code)}</h1>
        <p className="text-muted">{phase.error.message}</p>
        <Link
          href="/"
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Back to menu
        </Link>
      </main>
    );
  }

  const { room } = phase;

  // Status routing: lobby → render lobby; playing → render game; finished → game w/ winner overlay.
  // The `as RoomStatus` cast is safe: when phase is in_lobby, liveStatusRaw
  // resolves to a real status, never the fallback.
  const status = liveStatusRaw;
  const winnerPlayerId = roomRow?.winner_player_id ?? null;

  const settings = roomRow?.settings ?? DEFAULT_ROOM_SETTINGS;
  const visiblePlayers = players.filter(
    (p) => p.lobby_confirmed_at !== null || p.player_id === room.own_player_id,
  );

  if ((status === 'playing' || status === 'finished') && liveRoom) {
    // CRITICAL: pass `liveRoom`, not `room`. The phase.room snapshot from
    // joinRoom is never refreshed, but start-game always rolls a new random
    // puzzle, so phase.room.puzzle_code is stale by the time we get here.
    // Without the merge, two players who joined at different moments would
    // fetch DIFFERENT puzzles' givens. See the useMemo where liveRoom is
    // built (above the early returns) for the stability rationale.
    // Use liveRoom.mode (not room.mode) — see the liveRoom useMemo above.
    if (liveRoom.mode === 'coop') {
      return (
        <CoopGame
          room={liveRoom}
          players={visiblePlayers}
          settings={settings}
          serverStartedAt={roomRow?.started_at ?? null}
          finished={status === 'finished'}
        />
      );
    }
    return (
      <BattleGame
        room={liveRoom}
        players={visiblePlayers}
        settings={settings}
        serverStartedAt={roomRow?.started_at ?? null}
        winnerPlayerId={status === 'finished' ? winnerPlayerId : null}
      />
    );
  }

  const isHost = room.own_is_host;
  // Battle needs at least 2 players (a race against yourself is silly); coop
  // can start solo and pick up friends mid-game (#0024). Use liveMode so
  // toggling mode in the lobby immediately updates the player-count gate.
  const enoughPlayers = liveMode === 'battle' ? visiblePlayers.length >= 2 : visiblePlayers.length >= 1;
  const stragglers = visiblePlayers.filter((p) => !p.has_returned);
  const allReady = stragglers.length === 0;
  const otherHost = visiblePlayers.find((p) => p.is_host && p.player_id !== room.own_player_id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-8 px-6 py-4">
      <AppHeader
        left={
          <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
            ← Menu
          </Link>
        }
        center={
          <span className="text-xs font-medium uppercase tracking-widest text-muted">
            {liveMode === 'coop' ? 'co-op' : liveMode} · lobby
          </span>
        }
      />

      <section className="flex w-full flex-col items-center gap-3 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">
          Room code
        </p>
        <p className="text-4xl font-mono font-semibold tracking-[0.3em] text-foreground">
          {room.room_code}
        </p>
        <button
          type="button"
          onClick={onCopyShare}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          {shareCopied ? 'Link copied' : 'Copy share link'}
        </button>
      </section>

      <section className="w-full">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
          Players ({visiblePlayers.length}/8)
        </h2>
        <ul className="flex flex-col gap-2">
          {visiblePlayers.length === 0 ? (
            <li className="text-sm text-muted">Loading…</li>
          ) : null}
          {visiblePlayers.map((p) => {
            const isYou = p.player_id === room.own_player_id;
            return (
              <li
                key={p.player_id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <span
                  className={cn(
                    'flex items-center gap-3',
                    !p.has_returned && 'opacity-60',
                  )}
                >
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-full"
                    style={playerColorStyle(p.color, 'backgroundColor')}
                  />
                  <span className="font-medium text-foreground">{p.username}</span>
                  {p.is_host ? (
                    <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-foreground">
                      host
                    </span>
                  ) : null}
                  {isYou ? (
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted">
                      you
                    </span>
                  ) : null}
                  {!p.has_returned ? (
                    <span
                      aria-label="still in last game"
                      className="inline-flex items-center gap-0.5"
                    >
                      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-muted" />
                    </span>
                  ) : null}
                </span>
                <div className="flex items-center gap-3">
                  {isHost && !isYou ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await kickPlayer({
                          room_id: room.room_id,
                          player_id: p.player_id,
                        });
                      }}
                      className="text-xs text-danger underline-offset-2 hover:underline"
                    >
                      kick
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="w-full">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Difficulty
          {!isHost ? <span className="ml-2 text-muted normal-case tracking-normal">— host chooses</span> : null}
        </h2>
        {currentDifficulty === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : isHost && status === 'lobby' ? (
          <div className="grid grid-cols-5 gap-2">
            {VISIBLE_DIFFICULTIES.map((d) => {
              // Show the optimistic selection if we have one — keeps the
              // button visually in sync with the user's last click even
              // before the server confirms.
              const displayed = optimisticDifficulty ?? currentDifficulty;
              const selected = displayed === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChangeDifficulty(d)}
                  // Note: stay clickable while syncing. The user can click
                  // again to change their mind; the in-flight requests
                  // serialize through Supabase and the latest write wins.
                  disabled={selected}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                    selected ? lobbySelectorSelectedClassName : lobbySelectorIdleClassName,
                  )}
                >
                  {difficultyLabel(d)}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
            <span className="text-xs uppercase tracking-widest text-muted">selected</span>
            <span className="font-semibold text-foreground">{difficultyLabel(currentDifficulty)}</span>
          </div>
        )}
      </section>

      <section className="w-full">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Mode
          {!isHost ? <span className="ml-2 text-muted normal-case tracking-normal">— host chooses</span> : null}
        </h2>
        {isHost && status === 'lobby' ? (
          <div className="grid grid-cols-2 gap-2">
            {(['battle', 'coop'] as const).map((m) => {
              const selected = liveMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeMode(m)}
                  disabled={selected}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    selected ? lobbySelectorSelectedClassName : lobbySelectorIdleClassName,
                  )}
                >
                  {m === 'coop' ? 'Co-op' : 'Battle'}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
            <span className="text-xs uppercase tracking-widest text-muted">selected</span>
            <span className="font-semibold text-foreground">
              {liveMode === 'coop' ? 'Co-op' : 'Battle'}
            </span>
          </div>
        )}
      </section>

      <LobbySettingsPanel
        roomId={room.room_id}
        settings={settings}
        isPublic={roomRow?.is_public ?? false}
        isHost={isHost}
        locked={status !== 'lobby'}
        onPendingChange={(d) => setPendingSync((n) => Math.max(0, n + d))}
      />

      {/* Inline Start button — same action as the floating FAB. We render
          both so users who scroll past the lobby flow naturally encounter a
          Start at the bottom even if they didn't notice the FAB. The two
          buttons are wired to the same onStart/disabled state, so one
          updates the other instantly. */}
      {isHost ? (
        <section className="w-full text-center">
          <button
            type="button"
            onClick={onStart}
            disabled={startPending || !enoughPlayers || !allReady || pendingSync > 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-4 text-base font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingSync > 0 ? (
              <span
                aria-hidden
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
              />
            ) : null}
            <span>
              {startPending
                ? 'Starting…'
                : pendingSync > 0
                  ? 'Syncing…'
                  : !enoughPlayers
                    ? 'Waiting for at least 2 players…'
                    : !allReady
                      ? `Waiting on ${stragglers.length} player${stragglers.length === 1 ? '' : 's'}…`
                      : liveMode === 'coop'
                        ? 'Start co-op'
                        : 'Start battle'}
            </span>
          </button>
          {startError ? (
            <p className="mt-2 text-xs text-danger">{startError}</p>
          ) : null}
        </section>
      ) : (
        <section className="w-full text-center text-sm text-muted">
          Waiting for the host
          {otherHost ? ` (${otherHost.username})` : ''} to start…
        </section>
      )}

      <p className="text-xs text-muted">
        Share the room code with friends. Game begins when the host clicks Start.
      </p>

      {/* Extra bottom padding so the floating FAB doesn't sit on top of the
          last content line on short viewports. */}
      <div className="h-24" aria-hidden />

      {isHost ? (
        <StartFab
          mode={liveMode}
          disabled={startPending || !enoughPlayers || !allReady || pendingSync > 0}
          onClick={onStart}
          stateLabel={
            startPending
              ? 'Starting…'
              : pendingSync > 0
                ? 'Syncing…'
                : !enoughPlayers
                  ? 'Need 2+ players'
                  : !allReady
                    ? `Waiting on ${stragglers.length}`
                    : liveMode === 'coop'
                      ? 'Start co-op'
                      : 'Start battle'
          }
          loading={startPending || pendingSync > 0}
          errorText={startError}
        />
      ) : null}
    </main>
  );
}

/**
 * Floating action button anchored to the bottom-right of the viewport.
 * Replaces the old full-width black Start bar with a more prominent,
 * always-visible CTA. Disabled state stays visible (dimmed) so the host
 * always knows where to click; the dynamic label reflects why it's gated
 * (need 2+ players, waiting on stragglers, syncing, etc.).
 *
 * Error text bubbles up just above the button so the host sees it in their
 * line of sight without scrolling.
 */
function StartFab({
  mode,
  disabled,
  loading,
  stateLabel,
  errorText,
  onClick,
}: {
  mode: 'battle' | 'coop';
  disabled: boolean;
  loading: boolean;
  stateLabel: string;
  errorText: string | null;
  onClick: () => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {errorText ? (
        <p className="pointer-events-auto max-w-xs rounded-lg bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger-foreground shadow-sm">
          {errorText}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`${stateLabel} (${mode})`}
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary-hover hover:shadow-xl hover:shadow-primary/40 active:scale-95 disabled:cursor-not-allowed disabled:bg-muted disabled:shadow-md"
      >
        {loading ? (
          <span
            aria-hidden
            className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground"
          />
        ) : (
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-current"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
        <span>{stateLabel}</span>
      </button>
    </div>
  );
}

function lobbyErrorHeadline(code: RoomError['code']): string {
  switch (code) {
    case 'not_found':
      return "We couldn't find that room.";
    case 'room_in_progress':
      return 'This battle has already started.';
    case 'room_finished':
      return 'This room is already over.';
    case 'room_full':
      return 'This room is full.';
    case 'unauthenticated':
      return 'Sign-in failed.';
    case 'no_supabase':
      return 'Multiplayer is not available here.';
    default:
      return 'Something went wrong.';
  }
}
