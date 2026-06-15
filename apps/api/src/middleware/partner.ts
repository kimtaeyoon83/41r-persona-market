// Partner S2S auth — workspace-secret gate (Console S2, generalized).
//
// 2026-06-12: the geulbat env-key alias (`requireGeulbatKey` +
// PARTNER_API_KEY_GEULBAT) was removed by user decision — partners
// (geulbat included) register through the console and authenticate
// with their workspace secret (rpm_sk_…, sha256-stored, issued once).
//
// Trust model note: partner routes accept an `email` in the body,
// which the user-facing survey route deliberately does NOT (see the
// CLAUDE.md Do-NOT on surveyBody email — that rule is about browser-
// supplied identity). Here the email comes from the PARTNER'S SERVER,
// which verified it via OAuth on its side; the workspace secret is
// what makes that assertion trustworthy. Never mount partner ingest
// routes without this middleware.
//
// Behavior:
//   x-partner-key header missing → 401
//   not a known workspace secret → 403
//   match → next() with req.partnerSource = 'ws:<id>' +
//           req.partnerWorkspace attached

import type { RequestHandler } from 'express';
import { findWorkspaceBySecret, type Workspace } from '../services/workspaces.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'partner_auth' });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireSiteSecret: 'ws:<workspace_id>'. */
      partnerSource?: string;
      partnerWorkspace?: Workspace;
    }
  }
}

export const requireSiteSecret: RequestHandler = async (req, res, next) => {
  const got = req.header('x-partner-key');
  if (!got) {
    res.status(401).json({ error: 'partner_key_required', header: 'x-partner-key' });
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
