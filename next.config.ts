import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Journal shares this host with OpenClaw; reduce compiler memory and limit build workers.
  // One worker: with two, each worker's own heap pushed builds past the deploy's 7 GB cap (2026-10-18).
  experimental: { webpackMemoryOptimizations: true, cpus: 1 },
  // A production build keeps webpack's cache in memory only. Writing the on-disk cache at the end of the
  // compile held the whole of it in memory at once, and that is where builds were killed (2026-11-13: three
  // deploys in a row, 6.2 GB + 2 GB swap). Builds are no longer incremental; none of them finished anyway.
  webpack: (config, { dev }) => {
    if (!dev && config.cache) config.cache = Object.freeze({ type: 'memory' });
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/mastra/:path*',
        destination: 'http://127.0.0.1:4111/:path*',
      },
    ];
  },
};

export default nextConfig;
