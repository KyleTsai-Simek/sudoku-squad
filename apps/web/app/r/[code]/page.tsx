import type { Metadata } from 'next';
import { LobbyClient } from './lobby-client';
import { buildLobbyShareTitle, isValidRoomCode, LOBBY_SHARE_TEXT } from '@/lib/lobby-share';
import { fetchPublicRoomShare } from '@/lib/public-room-share';
import { siteUrl } from '@/lib/site-url';

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const room = isValidRoomCode(code) ? await fetchPublicRoomShare(code) : null;
  const title = buildLobbyShareTitle();
  const description = LOBBY_SHARE_TEXT;
  const canonical = new URL(`/r/${code}`, siteUrl()).toString();
  const imageUrl = new URL(`/r/${code}/opengraph-image`, siteUrl()).toString();

  if (!room) {
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        siteName: 'Sudoku Squad',
        type: 'website',
        images: [{ url: imageUrl, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [imageUrl],
      },
    };
  }

  const modeLabel = room.mode === 'coop' ? 'co-op' : 'battle';
  return {
    title,
    description: `${LOBBY_SHARE_TEXT} Join my ${modeLabel} lobby on Sudoku Squad.`,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'Sudoku Squad',
      type: 'website',
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function LobbyPage({ params }: Props) {
  const { code } = await params;
  return <LobbyClient code={code} />;
}
