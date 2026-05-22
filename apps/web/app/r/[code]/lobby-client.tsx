'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchRoom,
  fetchRoomPlayers,
  joinRoom,
  startGame,
  subscribeToRoom,
  subscribeToRoomPlayers,
  type RoomError,
  type RoomPlayerProgress,
  type RoomRow,
  type RoomState,
} from '@/lib/rooms';
import { getOrCreateUsername, setUsername } from '@/lib/username';
import { BattleGame } from './battle-game';

type Phase =
  | { kind: 'joining' }
  | { kind: 'in_lobby'; room: RoomState }
  | { kind: 'error'; error: RoomError };

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function LobbyClient({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'joining' });
  const [players, setPlayers] = useState<RoomPlayerProgress[]>([]);
  const [roomRow, setRoomRow] = useState<RoomRow | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [startPending, setStartPending] = useState(false);

  // 1. Join (or rejoin) the room on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const username = getOrCreateUsername();
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
    let cancelled = false;

    async function refreshPlayers() {
      const list = await fetchRoomPlayers(roomId);
      if (!cancelled) setPlayers(list);
    }
    async function refreshRoom() {
      const r = await fetchRoom(roomId);
      if (!cancelled) setRoomRow(r);
    }

    let unsubPlayers: (() => void) | null = null;
    let unsubRoom: (() => void) | null = null;
    (async () => {
      await Promise.all([refreshPlayers(), refreshRoom()]);
      if (cancelled) return;
      unsubPlayers = await subscribeToRoomPlayers(roomId, refreshPlayers);
      unsubRoom = await subscribeToRoom(roomId, refreshRoom);
    })();

    return () => {
      cancelled = true;
      unsubPlayers?.();
      unsubRoom?.();
    };
  }, [phase]);

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

  if (phase.kind === 'joining') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12 text-stone-500">
        Joining room…
      </main>
    );
  }

  if (phase.kind === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-red-500">
          {phase.error.code.replace(/_/g, ' ')}
        </p>
        <h1 className="text-2xl font-semibold">{lobbyErrorHeadline(phase.error.code)}</h1>
        <p className="text-stone-600">{phase.error.message}</p>
        <Link
          href="/"
          className="mt-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Back to menu
        </Link>
      </main>
    );
  }

  const { room } = phase;

  // Status routing: lobby → render lobby; playing → render game; finished → game w/ winner overlay.
  const status = roomRow?.status ?? room.status;
  const winnerPlayerId = roomRow?.winner_player_id ?? null;

  if (status === 'playing' || status === 'finished') {
    return (
      <BattleGame
        room={room}
        players={players}
        winnerPlayerId={status === 'finished' ? winnerPlayerId : null}
      />
    );
  }

  const isHost = room.own_is_host;
  const enoughPlayers = players.length >= 2;
  const otherHost = players.find((p) => p.is_host && p.player_id !== room.own_player_id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-8 px-6 py-10">
      <header className="flex w-full items-center justify-between">
        <Link href="/" className="text-sm font-medium text-stone-600 hover:text-stone-900">
          ← Menu
        </Link>
        <span className="text-xs font-medium uppercase tracking-widest text-stone-500">
          {room.mode} · lobby
        </span>
      </header>

      <section className="flex w-full flex-col items-center gap-3 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-stone-500">
          Room code
        </p>
        <p className="text-4xl font-mono font-semibold tracking-[0.3em] text-stone-900">
          {room.room_code}
        </p>
        <button
          type="button"
          onClick={onCopyShare}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
        >
          {shareCopied ? 'Link copied' : 'Copy share link'}
        </button>
      </section>

      <section className="w-full">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-500">
          Players ({players.length}/4)
        </h2>
        <ul className="flex flex-col gap-2">
          {players.length === 0 ? (
            <li className="text-sm text-stone-500">Loading…</li>
          ) : null}
          {players.map((p) => {
            const isYou = p.player_id === room.own_player_id;
            return (
              <li
                key={p.player_id}
                className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="font-medium text-stone-900">{p.username}</span>
                  {p.is_host ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      host
                    </span>
                  ) : null}
                  {isYou ? (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">
                      you
                    </span>
                  ) : null}
                </span>
                {isYou && !editingUsername ? (
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameDraft(p.username);
                      setEditingUsername(true);
                    }}
                    className="text-xs text-stone-500 underline-offset-2 hover:underline"
                  >
                    rename
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {editingUsername ? (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value)}
              maxLength={20}
              placeholder="username"
              className="flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                setUsername(usernameDraft);
                setEditingUsername(false);
              }}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingUsername(false)}
              className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </section>

      <section className={cn('w-full text-center', !isHost && 'text-stone-500')}>
        {isHost ? (
          <>
            <button
              type="button"
              onClick={onStart}
              disabled={startPending || !enoughPlayers}
              className="w-full rounded-xl bg-stone-900 px-5 py-4 text-base font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startPending
                ? 'Starting…'
                : !enoughPlayers
                  ? 'Waiting for at least 2 players…'
                  : 'Start battle'}
            </button>
            {startError ? (
              <p className="mt-2 text-xs text-red-600">{startError}</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm">
            Waiting for the host
            {otherHost ? ` (${otherHost.username})` : ''} to start…
          </p>
        )}
      </section>

      <p className="text-xs text-stone-400">
        Share the room code with friends. Game begins when the host clicks Start.
      </p>
    </main>
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
