'use client';

import { useEffect, useState } from 'react';
import { updateRoomSettings, type RoomSettings } from '@/lib/rooms';

interface Props {
  roomId: string;
  settings: RoomSettings;
  isPublic: boolean;
  /** Toggles are editable only when the caller is the host AND room is in lobby. */
  isHost: boolean;
  locked: boolean;
  /** Bubbles up so the parent's Start button can disable itself with a
   *  spinner while any setting/difficulty write is still syncing. */
  onPendingChange?: (delta: 1 | -1) => void;
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
  onPendingChange,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  // Optimistic overrides keyed by setting name. Each checkbox renders from
  // its override (if set) before the server-confirmed value. Cleared by an
  // effect when the server-confirmed value catches up.
  const [optimistic, setOptimistic] = useState<Partial<Record<keyof RoomSettings | 'is_public', boolean>>>({});

  // Sync the optimistic map with incoming props: drop any key whose
  // server-confirmed value now equals our pending value.
  useEffect(() => {
    setOptimistic((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(prev) as Array<keyof typeof prev>) {
        const target = key === 'is_public' ? isPublic : settings[key];
        if (target === prev[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [settings, isPublic]);

  async function onToggle(key: keyof RoomSettings, next: boolean) {
    setOptimistic((m) => ({ ...m, [key]: next }));
    setError(null);
    onPendingChange?.(1);
    const res = await updateRoomSettings({
      room_id: roomId,
      settings: { [key]: next } as Partial<RoomSettings>,
    });
    onPendingChange?.(-1);
    if (!res.ok) {
      // Roll back: drop the optimistic value so the checkbox snaps back to
      // the server-confirmed value.
      setOptimistic((m) => {
        const { [key]: _drop, ...rest } = m;
        return rest;
      });
      setError(res.error.message);
    }
  }

  async function onTogglePublic(next: boolean) {
    setOptimistic((m) => ({ ...m, is_public: next }));
    setError(null);
    onPendingChange?.(1);
    const res = await updateRoomSettings({ room_id: roomId, is_public: next });
    onPendingChange?.(-1);
    if (!res.ok) {
      setOptimistic((m) => {
        const { is_public: _drop, ...rest } = m;
        return rest;
      });
      setError(res.error.message);
    }
  }

  const disabled = !isHost || locked;
  const displayedPublic = optimistic.is_public ?? isPublic;

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
              checked={displayedPublic}
              disabled={disabled}
              onChange={(e) => onTogglePublic(e.target.checked)}
              className="h-5 w-5 cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
        </li>
        {TOGGLES.map((t) => {
          const displayed = optimistic[t.key] ?? settings[t.key];
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
                  checked={displayed}
                  disabled={disabled}
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
