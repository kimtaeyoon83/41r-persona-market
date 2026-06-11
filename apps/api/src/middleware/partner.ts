// Partner S2S auth — geulbat pilot (2026-06-10).
//
// Gates the partner ingest surface behind a per-partner shared secret
// header `x-partner-key`. Pattern mirrors middleware/admin.ts.
//
// Trust model note: partner routes accept an `email` in the body,
// which the user-facing survey route deliberately does NOT (see the
// CLAUDE.md Do-NOT on surveyBody email — that rule is about browser-
// supplied identity). Here the email comes from the PARTNER'S SERVER,
// which verified it via Google OAuth on its side; the partner key is
// what makes that assertion trustworthy. Never mount these routes
// without this middleware.
//
// Behavior:
//   - PARTNER_API_KEY_GEULBAT unset/short → 503 (partner ingest disabled)
//   - x-partner-key header missing        → 401
//   - x-partner-key mismatch              → 403
//   - match                               → next()

import type { RequestHandler } from 'express';
import { findWorkspaceBySecret, type Workspace } from '../services/workspaces.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'partner_auth' });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireSiteSecret: 'geulbat' (env-key pilot alias) or
       *  'ws:<workspace_id>' (self-serve workspace secret). */
      partnerSource?: string;
      /** Present when partnerSource is a workspace. */
      partnerWorkspace?: Workspace;
    }
  }
}

/**
 * Generalized S2S gate (Console Sprint 2). Accepts EITHER the legacy
 * env-configured geulbat key (alias preserved — zero-downtime for the
 * live pilot) OR any workspace secret issued through the console
 * (sha256 lookup). Attaches req.partnerSource (+ req.partnerWorkspace
 * for workspace keys) so handlers stop hardcoding 'geulbat'.
 *
 * requireGeulbatKey below stays for the existing /geulbat/* routes —
 * those paths are themselves the alias; new generic S2S surfaces
 * should mount this middleware instead.
 */
export const requireSiteSecret: RequestHandler = async (req, res, next) => {
  const got = req.header('x-partner-key');
  if (!got) {
    res.status(401).json({ error: 'partner_key_required', header: 'x-partner-key' });
    return;
  }
  const geulbat = process.env.PARTNER_API_KEY_GEULBAT;
  if (geulbat && geulbat.length >= 12 && got === geulbat) {
    req.partnerSource = 'geulbat';
    next();
    return;
  }
  try {
    const ws = await findWorkspaceBySecret(got);
    if (ws) {
      req.partnerSource = `ws:${ws.id}`;
      req.partnerWorkspace = ws;
      next();
      return;
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, 'workspace secret lookup failed');
    res.status(500).json({ error: 'internal_error' });
    return;
  }
  log.warn({ ip: req.ip, path: req.path }, 'partner key mismatch');
  res.status(403).json({ error: 'partner_key_invalid' });
};

export const requireGeulbatKey: RequestHandler = (req, res, next) => {
  const expected = process.env.PARTNER_API_KEY_GEULBAT;
  if (!expected || expected.length < 12) {
    log.warn('PARTNER_API_KEY_GEULBAT unset or too short — partner ingest disabled');
    res.status(503).json({
      error: 'partner_ingest_disabled',
      message: 'PARTNER_API_KEY_GEULBAT env not configured (must be ≥12 chars)',
    });
    return;
  }
  const got = req.header('x-partner-key');
  if (!got) {
    res.status(401).json({ error: 'partner_key_required', header: 'x-partner-key' });
    return;
  }
  if (got !== expected) {
    log.warn({ ip: req.ip, path: req.path }, 'partner key mismatch');
    res.status(403).json({ error: 'partner_key_invalid' });
    return;
  }
  next();
};
