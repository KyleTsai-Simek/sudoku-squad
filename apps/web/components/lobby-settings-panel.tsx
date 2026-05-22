'use client';

import { useState } from 'react';
import { updateRoomSettings, type RoomSettings } from '@/lib/rooms';

interface Props {
  roomId: string;
  settings: RoomSettings;
  isPublic: boolean;
  /** Toggles are editable only when the caller is the host AND room is in lobby. */
  isHost: boolean;
  locked: boolean;
}

interface Toggle {
  key: keyof RoomSettings;
  label: string;
  description: string;
}

const TOGGLES: Toggle[] = [
  {
    key: 'showConflicts',
    label: 'Show conflicts',
    description: 'Red-tint cells that break sudoku rules. No solution leak.',
  },
  {
    key: 'autoCheck',
    label: 'Auto-check',
    description: 'Flag wrong entries the moment they\'re placed.',
  },
  {
    key: 'highlightSameValue',
    label: 'Highlight same value',
    description: 'Dim other cells with the same number as the selected one.',
  },
];

export function LobbySettingsPanel({
  roomId,
  settings,
  isPublic,
  isHost,
  locked,
}: Props) {
  const [pending, setPending] = useState<keyof RoomSettings | 'is_public' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(key: keyof RoomSettings, next: boolean) {
    setPending(key);
    setError(null);
    const res = await updateRoomSettings({
      room_id: roomId,
      settings: { [key]: next } as Partial<RoomSettings>,
    });
    setPending(null);
    if (!res.ok) setError(res.error.message);
  }

  async function onTogglePublic(next: boolean) {
    setPending('is_public');
    setError(null);
    const res = await updateRoomSettings({ room_id: roomId, is_public: next });
    setPending(null);
    if (!res.ok) setError(res.error.message);
  }

  const disabled = !isHost || locked;

  return (
    <section className="w-full">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
        Settings {locked ? '(locked — game in progress)' : isHost ? '' : '(host only)'}
      </h2>
      <ul className="flex flex-col gap-2">
        <li className="flex items-start justify-between gap-4 rounded-lg border border-stone-200 bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-stone-900">Public lobby</p>
            <p className="text-xs text-stone-500">
              Anyone on the home page can see and join this room.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              checked={isPublic}
              disabled={disabled || pending === 'is_public'}
              onChange={(e) => onTogglePublic(e.target.checked)}
              className="h-5 w-5 cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
        </li>
        {TOGGLES.map((t) => {
          const value = settings[t.key];
          const busy = pending === t.key;
          return (
            <li
              key={t.key}
              className="flex items-start justify-between gap-4 rounded-lg border border-stone-200 bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">{t.label}</p>
                <p className="text-xs text-stone-500">{t.description}</p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={value}
                  disabled={disabled || busy}
                  onChange={(e) => onToggle(t.key, e.target.checked)}
                  className="h-5 w-5 cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                />
              </label>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
