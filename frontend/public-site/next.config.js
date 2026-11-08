/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Required for Next.js standalone Docker builds
  output: 'standalone',

  // Image optimization for remote images (S3/CloudFront)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: '*.cloudfront.net' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: 'minio' },
    ],
  },

  // Experimental: enable if you want server actions
  experimental: {},

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  // Redirect /article/:slug → /articles/:slug (if needed)
  async redirects() {
    return [];
  },
};

module.exports = nextConfig;