import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
