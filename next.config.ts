import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Journal shares this host with OpenClaw; reduce compiler memory and limit build workers.
  // One worker: with two, each worker's own heap pushed builds past the deploy's 7 GB cap (2026-10-18).
  experimental: { webpackMemoryOptimizations: true, cpus: 1 },
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
