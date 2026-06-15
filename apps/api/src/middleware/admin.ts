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

/** True when ADMIN_API_KEY is configured AND the request carries it.
 *  Use for operator-override checks inside otherwise user-gated
 *  handlers (e.g. human-aggregate on a scan the user doesn't own). */
export function isAdminRequest(req: Parameters<RequestHandler>[0]): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.length < 12) return false;
  return req.header('x-admin-key') === expected;
}

/**
 * Soft gate (Console Sprint 1) — enforces the admin key only when
 * ADMIN_API_KEY is configured. Local dev without the env stays open so
 * /validator/calibration keeps working out of the box; production
 * (key set) demotes the surface to operator-only per
 * console-ia-redesign.md §3.2.
 */
export const requireAdminKeyIfConfigured: RequestHandler = (req, res, next) => {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.length < 12) {
    next();
    return;
  }
  if (isAdminRequest(req)) {
    next();
    return;
  }
  res.status(403).json({ error: 'operator_only', header: 'x-admin-key' });
};

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
