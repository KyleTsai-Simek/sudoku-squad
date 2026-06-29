import { ImageResponse } from 'next/og';
import { difficultyLabel } from '@/lib/difficulty-labels';
import { fetchPublicPuzzle } from '@/lib/public-puzzle';
import { formatShareTime } from '@/lib/share-copy';
import { decodeShareTime, isValidDailyDate, isValidShareCode } from '@/lib/share-url';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: Promise<{ code: string; time: string }>;
  searchParams?: Promise<{ d?: string }>;
}

export default async function OpenGraphImage({ params, searchParams }: Props) {
  const { code, time: timeSegment } = await params;
  const { d } = (await searchParams) ?? {};
  const solveTimeMs = decodeShareTime(timeSegment);
  const puzzle = isValidShareCode(code) ? await fetchPublicPuzzle(code) : null;
  const givens = puzzle?.givens ?? [];
  const difficulty = puzzle ? difficultyLabel(puzzle.difficulty) : 'Sudoku';
  const time = solveTimeMs === null ? '--:--' : formatShareTime(solveTimeMs);
  const dailyDate = isValidDailyDate(d) ? d : undefined;

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
            <BoardPreview givens={givens} />
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '48px 56px',
              background: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: 58,
                  fontWeight: 600,
                  lineHeight: 1.05,
                  letterSpacing: -2.4,
                  color: '#0f172a',
                }}
              >
                Sudoku Squad
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                  <div style={{ display: 'flex', fontSize: 46, fontWeight: 700, lineHeight: 1 }}>
                    {difficulty}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      paddingBottom: 5,
                      fontSize: 24,
                      fontWeight: 700,
                      color: '#64748b',
                    }}
                  >
                    {code}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignSelf: 'flex-start',
                    border: '2px solid #bfdbfe',
                    borderRadius: 999,
                    background: '#dbeafe',
                    padding: '14px 24px',
                    fontSize: 30,
                    fontWeight: 800,
                    color: '#1e3a8a',
                  }}
                >
                  <span>Finished in&nbsp;</span>
                  <span style={{ fontSize: 34, fontWeight: 950, lineHeight: 1 }}>{time}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {dailyDate ? (
                <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: '#475569' }}>
                  {formatMonthDay(dailyDate)} daily puzzle
                </div>
              ) : null}
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
                Try this puzzle
              </div>
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

function formatMonthDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = year && month && day ? new Date(Date.UTC(year, month - 1, day, 12)) : new Date();
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(parsed);
}
