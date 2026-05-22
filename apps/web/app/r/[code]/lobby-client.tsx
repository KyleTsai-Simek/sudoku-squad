'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchRoomPlayers,
  joinRoom,
  subscribeToRoomPlayers,
  type RoomError,
  type RoomPlayer,
  type RoomState,
} from '@/lib/rooms';
import { getOrCreateUsername, setUsername } from '@/lib/username';

type Phase =
  | { kind: 'joining' }
  | { kind: 'in_lobby'; room: RoomState }
  | { kind: 'error'; error: RoomError };

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function LobbyClient({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'joining' });
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');

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

  // 2. Once joined, fetch the player list + subscribe to changes.
  useEffect(() => {
    if (phase.kind !== 'in_lobby') return;
    const roomId = phase.room.room_id;
    let cancelled = false;

    async function refresh() {
      const list = await fetchRoomPlayers(roomId);
      if (!cancelled) setPlayers(list);
    }

    let unsub: (() => void) | null = null;
    (async () => {
      await refresh();
      if (cancelled) return;
      unsub = await subscribeToRoomPlayers(roomId, refresh);
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
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
  const isHost = room.own_is_host;
  const otherPlayers = players.filter((p) => p.player_id !== room.own_player_id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-8 px-6 py-10">
      <header className="flex w-full items-center justify-between">
        <Link href="/" className="text-sm font-medium text-stone-600 hover:text-stone-900">
          ← Menu
        </Link>
        <span className="text-xs font-medium uppercase tracking-widest text-stone-500">
          {room.mode} · {room.status}
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
                // For V1 we just persist locally — the lobby still shows the
                // username we sent at join time. A future rename Edge Function
                // can update the room_players row.
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
          <button
            type="button"
            disabled
            title="Phase 2 — coming soon"
            className="w-full cursor-not-allowed rounded-xl border border-dashed border-stone-300 px-5 py-4 text-base font-semibold text-stone-400"
          >
            Start battle (coming soon)
          </button>
        ) : (
          <p className="text-sm">
            Waiting for the host{' '}
            {otherPlayers.find((p) => p.is_host)?.username
              ? `(${otherPlayers.find((p) => p.is_host)!.username}) `
              : ''}
            to start…
          </p>
        )}
      </section>

      <p className="text-xs text-stone-400">
        Lobby is live. Game start lands in the next session.
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
