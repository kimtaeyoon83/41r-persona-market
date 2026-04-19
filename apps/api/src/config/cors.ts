import type { CorsOptions } from 'cors';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://web-production-8813d.up.railway.app',
];

export const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ??
  DEFAULT_ALLOWED_ORIGINS
);

export function isOriginAllowed(origin: string | undefined, allowlist = allowedOrigins): boolean {
  // No Origin header = tools/server-to-server/same-origin — always allowed
  if (!origin) return true;
  return allowlist.includes(origin);
}

export const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not in allowlist`));
  },
  credentials: true,
};
