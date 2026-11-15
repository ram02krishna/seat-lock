/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/shared'],
<<<<<<< HEAD
=======
  async rewrites() {
    const proxyTarget = process.env.API_PROXY_URL;
    if (proxyTarget) {
      return [
        {
          source: '/api/:path*',
          destination: `${proxyTarget}/api/:path*`,
        },
      ];
    }
    return [];
  },
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
