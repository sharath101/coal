import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// The website talks to the backend only through the API. In local work the API is proxied
// under the same origin, so the session cookie stays first-party.
const apiUrl = process.env.COAL_API_URL ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  transpilePackages: ['@coal/shared'],
  // The assistant's replies stream for up to a few minutes while a long document is written.
  experimental: { proxyTimeout: 10 * 60_000 },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
