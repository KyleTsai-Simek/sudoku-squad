'use client';

import type { Difficulty } from '@sudoku-squad/core';
import {
  createRoom,
  updateRoomSettings,
  type RoomMode,
  type RoomState,
  type RoomError,
} from './rooms';
import { getUsername } from './username';

type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

interface WarmRoom {
  difficulty: Difficulty;
  promise: Promise<Result<RoomState>>;
}

const warmRooms = new Map<RoomMode, WarmRoom>();

async function createPrivateRoom(
  mode: RoomMode,
  difficulty: Difficulty,
): Promise<Result<RoomState>> {
  try {
    const username = await getUsername();
    return await createRoom({ mode, difficulty, username, is_public: false });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : 'Could not create room',
      },
    };
  }
}

export function preloadMultiplayerRooms(difficulty: Difficulty): void {
  for (const mode of ['coop', 'battle'] as const) {
    const existing = warmRooms.get(mode);
    if (existing?.difficulty === difficulty) continue;
    warmRooms.set(mode, {
      difficulty,
      promise: createPrivateRoom(mode, difficulty),
    });
  }
}

export async function consumePreloadedRoom(
  mode: RoomMode,
  difficulty: Difficulty,
): Promise<Result<RoomState>> {
  const existing = warmRooms.get(mode);
  if (existing?.difficulty === difficulty) {
    warmRooms.delete(mode);
    const warmed = await existing.promise;
    if (warmed.ok) {
      const published = await updateRoomSettings({
        room_id: warmed.value.room_id,
        is_public: true,
      });
      if (!published.ok) return published;
      return warmed;
    }
  }
  try {
    const username = await getUsername();
    return await createRoom({ mode, difficulty, username, is_public: true });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: error instanceof Error ? error.message : 'Could not create room',
      },
    };
  }
}
