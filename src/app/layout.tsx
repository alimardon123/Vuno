import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter, JetBrains_Mono, Plus_Jakarta_Sans, Source_Serif_4 } from 'next/font/google';
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
// Studio and Daylight are one design language in two grounds, and the face is
// half of what makes it: a humanist geometric with open counters, which stays
// readable at 11px metadata while carrying a name at 14.5 with some presence.
const studioSans = Plus_Jakarta_Sans({
  variable: '--font-studio-sans',
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
    { media: '(prefers-color-scheme: dark)', color: '#0C0D11' },
    { media: '(prefers-color-scheme: light)', color: '#FAFAFA' },
  ],
};

// Applied before first paint. Without it every load flashes the default theme
// before the stored preference is read, which is the most obvious kind of jank.
const THEME_BOOTSTRAP = `
(function () {
  try {
    var t = localStorage.getItem('vuno-theme');
    if (t === 'studio' || t === 'daylight' || t === 'ink' || t === 'paper' || t === 'warm' || t === 'ledger' || t === 'console') {
      document.documentElement.setAttribute('data-theme', t);
      return;
    }
  } catch (e) {}
  document.documentElement.setAttribute(
    'data-theme',
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'studio'
  );
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="studio" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} ${ledgerSerif.variable} ${consoleMono.variable} ${studioSans.variable}`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
