import { siteUrl } from './site-url';

export const LOBBY_SHARE_TEXT = 'Tap this link to play sudoku with me!';

const ROOM_CODE_PATTERN = /^[a-z0-9]{3,16}$/;

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export function buildLobbySharePath(roomCode: string): string {
  return `/r/${roomCode.toLowerCase()}`;
}

export function buildAbsoluteLobbyShareUrl(roomCode: string, origin?: string): string {
  return new URL(buildLobbySharePath(roomCode), origin ?? siteUrl()).toString();
}

export function buildLobbyClipboardText(roomCode: string, origin?: string): string {
  return `${LOBBY_SHARE_TEXT}\n${buildAbsoluteLobbyShareUrl(roomCode, origin)}`;
}

export function buildLobbyShareTitle(): string {
  return 'Play Sudoku Squad with me';
}
