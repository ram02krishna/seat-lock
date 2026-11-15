import { config } from './config';

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;

  const rawOrigins = config.CLIENT_URL || 'http://localhost:3000';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  // This API uses credentialed cookies, so never reflect arbitrary origins from a wildcard.
  // Even in development, exact localhost/LAN origins are handled explicitly below.
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Allow localhost, 127.0.0.1, and private LAN IP addresses in development
  if (
    config.NODE_ENV !== 'production' &&
    (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
      /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin))
  ) {
    return true;
  }

  // Preview deployments must be added as exact trusted origins in CLIENT_URL.
  // Allowing every *.vercel.app site would reflect arbitrary origins with session cookies.

  return false;
}
