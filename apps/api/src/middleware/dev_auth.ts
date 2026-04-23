/**
 * Dev-harness auth. Every /api/dev/* endpoint requires the x-dev-key
 * header to match the DEV_TEST_KEY env var. If the env var is unset
 * the whole router is never mounted (see index.ts) so the endpoints
 * 404 silently — there's no "this route exists, try harder" signal.
 *
 * This is intentionally *not* the signed-request path used by the
 * production mutating routes. The harness exists to let the assistant
 * drive the full pipeline end-to-end without the wallet signing loop,
 * and should only ever carry a single operator secret.
 */
import type { Request, Response, NextFunction } from 'express';

const DEV_KEY = process.env.DEV_TEST_KEY ?? '';

export const devHarnessEnabled = DEV_KEY.length >= 12;

export function requireDevKey(req: Request, res: Response, next: NextFunction): void {
  if (!devHarnessEnabled) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const supplied = String(req.header('x-dev-key') ?? '');
  if (supplied !== DEV_KEY) {
    // Match the "not mounted" 404 so a probe can't tell whether the
    // key exists vs the value is wrong.
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}
