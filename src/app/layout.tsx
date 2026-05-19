'use client';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { CedarCopilot, ProviderConfig } from 'cedar-os';
import { messageRenderers } from '@/cedar/messageRenderers';
import { ThemeProvider } from '@/components/ThemeProvider';
import { RefreshProvider } from '@/lib/RefreshContext';

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
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <RefreshProvider>
            <CedarCopilot
              userId={'Test User'}
              threadId={'Test Thread'}
              llmProvider={llmProvider}
              messageRenderers={messageRenderers}
            >
              {children}
            </CedarCopilot>
          </RefreshProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
