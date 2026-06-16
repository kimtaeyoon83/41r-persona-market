import type { CorsOptions } from 'cors';
import { env } from './env.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://web-production-8813d.up.railway.app',
];

export const allowedOrigins = (
  env.CORS_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ??
  DEFAULT_ALLOWED_ORIGINS
);

export function isOriginAllowed(origin: string | undefined, allowlist = allowedOrigins): boolean {
  // No Origin header = tools/server-to-server/same-origin — always allowed
  if (!origin) return true;
  return allowlist.includes(origin);
}

export const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    // Allowed origins get the reflected ACAO (credentialed reads work).
    // A disallowed origin is NOT an error: returning cb(null, false)
    // omits the CORS headers but still lets the request reach its
    // handler. Throwing here 500s the request BEFORE the handler runs,
    // which silently broke the public partner beacon (/api/partner/t):
    // it is embedded on ARBITRARY partner domains by design (GA-style
    // public ingestion, sent as a text/plain simple request), so it can
    // never be allowlisted and must still be recorded. Auth is enforced
    // by partner-key / Privy bearer, not by CORS — omitting ACAO only
    // stops a disallowed browser origin from READING the response, which
    // is exactly the intended boundary.
    if (isOriginAllowed(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
};
