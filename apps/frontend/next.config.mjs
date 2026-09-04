/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les types et schémas Zod partagés sont consommés depuis leur source
  // compilée du workspace : Next doit les transpiler comme du code local.
  transpilePackages: ['@sentinel/shared-types'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // En-têtes de sécurité côté frontend (docs/SECURITY.md A05).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            // Les lignes de log sont rendues comme texte, jamais comme HTML :
            // cette CSP est la seconde barrière si une régression l'oubliait.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + ' ws: wss:',
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
