import pino from 'pino';

// Structured logger. Railway parses JSON well — we emit JSON everywhere so
// local dev matches prod formatting. If a human needs pretty output they can
// pipe through `pino-pretty` locally.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: '41r-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
