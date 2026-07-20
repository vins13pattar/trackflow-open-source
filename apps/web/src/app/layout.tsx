import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ErrorListener } from '@/components/ErrorListener';
import { ThemeScript } from '@/components/theme';
import { AuthProvider } from '@/lib/auth';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'TrackFlow — GPS Tracking Platform',
  description: 'Real-time multi-tenant GPS tracking, geofencing and fleet analytics.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans">
        <ErrorListener />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
