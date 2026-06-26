import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sudoku Squad',
  description: 'Daily, solo, and multiplayer sudoku.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var key = 'sudokusquad:theme';
  var preference = localStorage.getItem(key) || 'auto';
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = preference === 'dark' || (preference === 'auto' && systemDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
} catch (_) {}
`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
