import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { difficultyLabel } from '@/lib/difficulty-labels';
import { fetchPublicPuzzle } from '@/lib/public-puzzle';
import { formatShareTime } from '@/lib/share-copy';
import { decodeShareTime, isValidDailyDate, isValidShareCode } from '@/lib/share-url';

export const runtime = 'nodejs';

interface Props {
  params: Promise<{ code: string; time: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { code, time: timeSegment } = await params;
  const solveTimeMs = decodeShareTime(timeSegment);
  const puzzle = isValidShareCode(code) ? await fetchPublicPuzzle(code) : null;
  const givens = puzzle?.givens ?? [];
  const difficulty = puzzle ? difficultyLabel(puzzle.difficulty) : 'Sudoku';
  const time = solveTimeMs === null ? '--:--' : formatShareTime(solveTimeMs);
  const dailyDateParam = request.nextUrl.searchParams.get('d') ?? undefined;
  const dailyDate = isValidDailyDate(dailyDateParam) ? dailyDateParam : undefined;
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
            <BoardPreview givens={givens} />
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
              {dailyDate ? <DailyBadge date={dailyDate} /> : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                  <div style={{ display: 'flex', fontSize: 39, fontWeight: 700, lineHeight: 1 }}>
                    {difficulty}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      paddingBottom: 5,
                      fontSize: 20,
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
                    fontSize: 26,
                    fontWeight: 850,
                    color: '#0f172a',
                  }}
                >
                  <span>Finished in&nbsp;</span>
                  <FauxBoldTime value={time} />
                </div>
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
              Try this puzzle
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
    } catch {
      // Fall back to the text title until a logo asset is provided.
    }
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
    letterSpacing: -2.4,
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

function FauxBoldTime({ value }: { value: string }) {
  const baseStyle = {
    position: 'absolute' as const,
    top: 0,
    display: 'flex',
    fontSize: 32,
    fontWeight: 900,
    lineHeight: 1,
    color: '#0f172a',
  };

  return (
    <span style={{ position: 'relative', display: 'flex', width: 68, height: 32 }}>
      <span style={{ ...baseStyle, left: 0 }}>{value}</span>
      <span style={{ ...baseStyle, left: 0.6 }}>{value}</span>
    </span>
  );
}

function DailyBadge({ date }: { date: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 10,
        padding: 0,
        fontSize: 22,
        fontWeight: 800,
        color: '#475569',
      }}
    >
      <CalendarGlyph />
      <span>{formatMonthDay(date)} Daily Puzzle</span>
    </div>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 -960 960 960" width="24" height="24" fill="#475569">
      <path d="M280-320h80v-80h-80v80Zm160 0h80v-80h-80v80Zm160 0h80v-80h-80v80ZM280-480h80v-80h-80v80Zm160 0h80v-80h-80v80Zm160 0h80v-80h-80v80ZM200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Z" />
    </svg>
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
