import { ImageResponse } from 'next/og';
import { verifyShareToken } from '@/lib/share-token';
import { difficultyLabel } from '@/lib/difficulty-labels';
import { formatShareTime, shareModeLabel } from '@/lib/share-copy';
import { fetchPublicPuzzle } from '@/lib/public-puzzle';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function OpenGraphImage({ params }: Props) {
  const { token } = await params;
  const payload = verifyShareToken(token);
  const puzzle = payload ? await fetchPublicPuzzle(payload.puzzleCode) : null;
  const givens = puzzle?.givens ?? [];
  const difficulty = payload ? difficultyLabel(payload.difficulty) : 'Sudoku';
  const time = payload ? formatShareTime(payload.solveTimeMs) : '--:--';
  const mode = payload
    ? payload.mode === 'single'
      ? 'Try this puzzle'
      : `Try this ${shareModeLabel(payload.mode)} puzzle`
    : 'Try this puzzle';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          padding: 58,
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
              width: 470,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#eff6ff',
              padding: 52,
            }}
          >
            <BoardPreview givens={givens} />
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '56px 60px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: '#1d4ed8' }}>
                Sudoku Squad
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    color: '#b45309',
                  }}
                >
                  {mode}
                </div>
                <div style={{ display: 'flex', fontSize: 70, fontWeight: 900, lineHeight: 1 }}>
                  {difficulty}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18 }}>
              <Stat label="Finished in" value={time} />
              {payload?.playerCount ? <Stat label="Players" value={String(payload.playerCount)} /> : null}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        borderRadius: 18,
        background: '#eff6ff',
        border: '2px solid #bfdbfe',
        padding: '18px 24px',
        minWidth: 190,
      }}
    >
      <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: '#475569' }}>
        {label}
      </div>
      <div style={{ display: 'flex', fontSize: 38, fontWeight: 900, color: '#0f172a' }}>
        {value}
      </div>
    </div>
  );
}
