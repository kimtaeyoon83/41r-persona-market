import pino from 'pino';
import { env, isProd } from './config/env.js';

// Structured logger. Railway parses JSON well — we emit JSON everywhere so
// local dev matches prod formatting. If a human needs pretty output they can
// pipe through `pino-pretty` locally.
export const logger = pino({
  level: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: { service: '41r-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
