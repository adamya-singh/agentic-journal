'use client';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { CedarCopilot, ProviderConfig } from 'cedar-os';
import { messageRenderers } from '@/cedar/messageRenderers';
import { ThemeProvider } from '@/components/ThemeProvider';
import { RefreshProvider } from '@/lib/RefreshContext';
import { QuickCaptureProvider } from '@/components/quick-capture/QuickCaptureProvider';
import { BugsFeaturesProvider } from '@/components/bugs-features/BugsFeaturesProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const llmProvider: ProviderConfig = {
    provider: 'mastra' as const,
    baseURL: process.env.NEXT_PUBLIC_MASTRA_URL || '/mastra',
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {/* Add to Home Screen. This layout is a client component (no metadata export), so the tags are written
            by hand; src/app/manifest.ts is still served at /manifest.webmanifest. No service worker. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Journal" />
        {/* "default", not "black-translucent": translucent always draws white status-bar text over the page, and
            the header is white in light mode and scrolls away, so the time and battery would vanish. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111827" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <RefreshProvider>
            <QuickCaptureProvider>
              <BugsFeaturesProvider>
                <CedarCopilot
                  userId={'Test User'}
                  threadId={'Test Thread'}
                  llmProvider={llmProvider}
                  messageRenderers={messageRenderers}
                >
                  {children}
                </CedarCopilot>
              </BugsFeaturesProvider>
            </QuickCaptureProvider>
          </RefreshProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
