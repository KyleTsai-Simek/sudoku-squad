import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { fetchPublicPuzzle, type PublicPuzzle } from '@/lib/public-puzzle';
import { fetchPublicRoomShare } from '@/lib/public-room-share';
import { isValidRoomCode } from '@/lib/lobby-share';

export const runtime = 'nodejs';

interface Props {
  params: Promise<{ code: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { code } = await params;
  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const previewPuzzleCode = request.nextUrl.searchParams.get('p') ?? '3santv';

  const room = !preview && isValidRoomCode(code) ? await fetchPublicRoomShare(code) : null;
  const previewPuzzle = preview ? await fetchPublicPuzzle(previewPuzzleCode) : null;
  const puzzle: PublicPuzzle | null = room?.puzzle ?? previewPuzzle;
  const logoDataUrl = await loadLogoDataUrl();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 48,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            border: '4px solid #1d4ed8',
            borderRadius: 28,
            background: '#ffffff',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.18)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: 460,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#eff6ff',
              padding: 48,
            }}
          >
            <BoardPreview givens={puzzle?.givens ?? []} />
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: '48px 56px',
              background: '#ffffff',
            }}
          >
            <BrandLogo logoDataUrl={logoDataUrl} />

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 18,
                paddingBottom: 18,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 39,
                  fontWeight: 700,
                  lineHeight: 1.08,
                  color: '#0f172a',
                }}
              >
                Play sudoku with me!
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                borderRadius: 12,
                background: '#1d4ed8',
                padding: '18px 30px',
                fontSize: 30,
                fontWeight: 800,
                color: '#ffffff',
              }}
            >
              Join game
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

async function loadLogoDataUrl(): Promise<string | null> {
  const publicDir = join(process.cwd(), 'public', 'brand');
  const candidates = [
    { path: join(publicDir, 'sudoku-squad-logo.png'), mime: 'image/png' },
    { path: join(publicDir, 'sudoku-squad-logo.svg'), mime: 'image/svg+xml' },
  ];

  for (const candidate of candidates) {
    try {
      const data = await readFile(candidate.path);
      return `data:${candidate.mime};base64,${data.toString('base64')}`;
    } catch {}
  }
  return null;
}

function BrandLogo({ logoDataUrl }: { logoDataUrl: string | null }) {
  if (logoDataUrl) {
    return (
      <img
        src={logoDataUrl}
        alt="Sudoku Squad"
        width={360}
        height={78}
        style={{ width: 360, height: 78, objectFit: 'contain', objectPosition: 'left center' }}
      />
    );
  }
  return <FauxBoldTitle />;
}

function FauxBoldTitle() {
  const baseStyle = {
    position: 'absolute' as const,
    top: 0,
    display: 'flex',
    fontSize: 58,
    fontWeight: 700,
    lineHeight: 1.05,
    color: '#0f172a',
  };

  return (
    <div style={{ position: 'relative', display: 'flex', width: 440, height: 66 }}>
      <div style={{ ...baseStyle, left: 0 }}>Sudoku Squad</div>
      <div style={{ ...baseStyle, left: 0.8 }}>Sudoku Squad</div>
      <div style={{ ...baseStyle, left: 0, top: 0.6 }}>Sudoku Squad</div>
    </div>
  );
}

function BoardPreview({ givens }: { givens: number[] }) {
  return (
    <div
      style={{
        width: 350,
        height: 350,
        display: 'flex',
        flexWrap: 'wrap',
        border: '5px solid #0f172a',
        background: '#ffffff',
      }}
    >
      {Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const value = givens[index] ?? 0;
        return (
          <div
            key={index}
            style={{
              width: `${100 / 9}%`,
              height: `${100 / 9}%`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: col === 8 ? '0' : `${col === 2 || col === 5 ? 3 : 1}px solid #94a3b8`,
              borderBottom: row === 8 ? '0' : `${row === 2 || row === 5 ? 3 : 1}px solid #94a3b8`,
              background: value ? '#f8fafc' : '#ffffff',
              color: value ? '#475569' : '#ffffff',
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            {value || ''}
          </div>
        );
      })}
    </div>
  );
}
