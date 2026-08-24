import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });
const mono = JetBrains_Mono({ variable: '--font-mono-stack', subsets: ['latin'], display: 'swap' });

// The two directions carry their own type — that is most of what makes them
// directions rather than palettes. `preload: false` because a viewer on Ink
// should not pay to download a serif they will never see; the browser fetches
// these only when a rule under the direction's selector actually asks for them.
const ledgerSerif = Source_Serif_4({
  variable: '--font-ledger-serif',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
});
const consoleMono = IBM_Plex_Mono({
  variable: '--font-console-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'Vuno',
  description:
    'A communication app on the surface. A working organisation underneath — where people and agents are the same kind of member, and every claim carries a status and a provenance.',
  icons: { icon: '/logo.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0F1215' },
    { media: '(prefers-color-scheme: light)', color: '#F6F7F8' },
  ],
};

// Applied before first paint. Without it every load flashes the default theme
// before the stored preference is read, which is the most obvious kind of jank.
const THEME_BOOTSTRAP = `
(function () {
  try {
    var t = localStorage.getItem('vuno-theme');
    if (t === 'ink' || t === 'paper' || t === 'warm' || t === 'ledger' || t === 'console') {
      document.documentElement.setAttribute('data-theme', t);
      return;
    }
  } catch (e) {}
  document.documentElement.setAttribute(
    'data-theme',
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'ink'
  );
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="ink" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} ${ledgerSerif.variable} ${consoleMono.variable}`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
