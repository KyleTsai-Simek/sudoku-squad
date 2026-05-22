/**
 * Room settings shape. Stored as `rooms.settings jsonb`. Host edits in lobby
 * (Chunk D); locks at Start (`status='playing'`). Unknown keys are ignored.
 */

export interface RoomSettings {
  showConflicts: boolean;
  autoCheck: boolean;
  highlightSameValue: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  showConflicts: true,
  autoCheck: false,
  highlightSameValue: true,
};

/** Sanitize untrusted input into a known-good RoomSettings, falling back to defaults. */
export function normalizeSettings(input: unknown): RoomSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_ROOM_SETTINGS };
  const i = input as Record<string, unknown>;
  return {
    showConflicts:
      typeof i.showConflicts === 'boolean'
        ? i.showConflicts
        : DEFAULT_ROOM_SETTINGS.showConflicts,
    autoCheck:
      typeof i.autoCheck === 'boolean' ? i.autoCheck : DEFAULT_ROOM_SETTINGS.autoCheck,
    highlightSameValue:
      typeof i.highlightSameValue === 'boolean'
        ? i.highlightSameValue
        : DEFAULT_ROOM_SETTINGS.highlightSameValue,
  };
}
