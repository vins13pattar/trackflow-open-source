const isDev = process.env.NODE_ENV === 'development';

// CSP notes:
// - script-src: Next.js injects inline bootstrap scripts → 'unsafe-inline';
//   dev additionally needs 'unsafe-eval' for react-refresh. Razorpay checkout
//   loads its modal from checkout.razorpay.com.
// - img/connect-src allow https: because map styles/tiles + tenant logos are
//   operator-configurable hosts (NEXT_PUBLIC_MAP_STYLE_URL, branding logoUrl).
// - worker-src blob: is required by MapLibre GL.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https:${isDev ? ' http://localhost:8787 http://127.0.0.1:8787 ws:' : ''}`,
  "worker-src 'self' blob:",
  'frame-src https://api.razorpay.com https://checkout.razorpay.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Optional same-origin API proxy for local demos and deployments that
    // front web + API behind one hostname. The target remains server-only.
    const target = process.env.API_PROXY_TARGET;
    return target ? [{ source: '/api/:path*', destination: `${target}/:path*` }] : [];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
