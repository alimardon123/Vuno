import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });
const mono = JetBrains_Mono({ variable: '--font-mono-stack', subsets: ['latin'], display: 'swap' });

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
    if (t === 'ink' || t === 'paper' || t === 'warm') {
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
      <body className={`${inter.variable} ${mono.variable}`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
