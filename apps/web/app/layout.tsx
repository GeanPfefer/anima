import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Anima',
  description: 'Você é o personagem. A vida é o mapa.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Anima',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Anima',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
