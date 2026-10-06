import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Journal shares this host with OpenClaw; reduce compiler memory and limit build workers.
  experimental: { webpackMemoryOptimizations: true, cpus: 2 },
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
