// Admin auth middleware — Phase 2-D.
//
// Gates infrastructure-level mutating endpoints (calibration Track A
// trigger, future Pro-tier admin actions) behind a shared secret
// header `x-admin-key`. Pattern mirrors middleware/dev_auth.ts but
// for production-relevant routes that need protection even on
// mainnet, not just local dev.
//
// Behavior:
//   - ADMIN_API_KEY env unset/short  → 503 (admin endpoints disabled)
//   - x-admin-key header missing      → 401
//   - x-admin-key mismatch            → 403
//   - match                           → next()
//
// Use for routes that should only run from CI / cron / ops shell,
// never directly from a browser session.

import type { RequestHandler } from 'express';
import { logger } from '../logger.js';

const log = logger.child({ service: 'admin_auth' });

export const requireAdminKey: RequestHandler = (req, res, next) => {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.length < 12) {
    log.warn('ADMIN_API_KEY unset or too short — admin endpoints disabled');
    res.status(503).json({
      error: 'admin_endpoints_disabled',
      message: 'ADMIN_API_KEY env not configured (must be ≥12 chars)',
    });
    return;
  }
  const got = req.header('x-admin-key');
  if (!got) {
    res
      .status(401)
      .json({ error: 'admin_key_required', header: 'x-admin-key' });
    return;
  }
  if (got !== expected) {
    log.warn({ ip: req.ip, path: req.path }, 'admin key mismatch');
    res.status(403).json({ error: 'admin_key_invalid' });
    return;
  }
  next();
};
