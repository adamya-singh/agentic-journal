import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest. The root layout is a client component, so it can't export metadata and
// Next won't add the <link rel="manifest"> itself; layout.tsx writes that link (and the iOS tags) by hand.
// Colours: the dark header and page background (Tailwind gray-900), which the dawn icon also sits well on.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agentic Journal',
    short_name: 'Journal',
    description: 'Tasks, journal, jobs and media, steered with OpenClaw.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#111827',
    theme_color: '#111827',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
