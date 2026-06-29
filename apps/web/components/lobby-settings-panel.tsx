'use client';

import { useEffect, useId, useState } from 'react';
import { updateRoomSettings, type RoomSettings } from '@/lib/rooms';
import { ExpandMoreIcon, SettingsOutlinedIcon } from './material-icons';

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

const checkboxClassName =
  'h-5 w-5 cursor-pointer accent-selected disabled:cursor-not-allowed disabled:opacity-40';

export function LobbySettingsPanel({
  roomId,
  settings,
  isPublic,
  isHost,
  locked,
  onPendingChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
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
      <h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((open) => !open)}
          className="mb-2 inline-flex items-center gap-1 text-left"
        >
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
            <SettingsOutlinedIcon size={16} className="shrink-0" />
            <span>Lobby Settings</span>
            {locked ? (
              <span className="ml-2 text-muted normal-case tracking-normal">
                - locked
              </span>
            ) : null}
          </span>
          <ExpandMoreIcon
            size={18}
            className={[
              'shrink-0 text-muted transition-transform',
              expanded ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>
      </h2>
      <div id={panelId} hidden={!expanded}>
        <ul className="flex flex-col gap-2">
          <li className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Public lobby</p>
              <p className="text-xs text-muted">
                Anyone on the home page can see and join this room.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={displayedPublic}
                disabled={disabled}
                onChange={(e) => onTogglePublic(e.target.checked)}
                className={checkboxClassName}
              />
            </label>
          </li>
          {TOGGLES.map((t) => {
            const displayed = optimistic[t.key] ?? settings[t.key];
            return (
              <li
                key={t.key}
                className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t.label}</p>
                  <p className="text-xs text-muted">{t.description}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={displayed}
                    disabled={disabled}
                    onChange={(e) => onToggle(t.key, e.target.checked)}
                    className={checkboxClassName}
                  />
                </label>
              </li>
            );
          })}
        </ul>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </div>
    </section>
  );
}
