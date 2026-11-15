import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { Navbar } from '@/components/navbar';
import { BackendBanner } from '@/components/backend-banner';

export const metadata: Metadata = {
  title: { default: 'SeatLock', template: '%s · SeatLock' },
  description: 'Pick your exact seats on a live seat map. Seats are held for you while you check out.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
  ],
};

// Runs before first paint so there is no light/dark flash on load.
const themeInit = `
(function () {
  try {
    var stored = localStorage.getItem('app-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Manrope:wght@500;600;700;800&display=swap"
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Navbar />
          <BackendBanner />
          <div className="flex-1">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
