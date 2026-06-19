// /api/session — session planning surface (design doc v0.4 §3.5).
//
// POST /api/session/plan — validate + resolve a session request through
// planSession(). This is the HTTP face of the cross-axis rules: a
// capture_react request resolves to a plan; an autonomous (Mode C) request
// returns 422 mode_c_gated until the think-aloud build gate opens
// (env THINK_ALOUD_GATE_PASSED, false in production). The gate flag is the
// single switch — this route never bypasses it.
//
// Dispatch (actually running a Mode C traversal via runModeCSession →
// traverseGraph) is deliberately NOT exposed here yet: it needs real graph
// capture + LLM perception/decision, which land when the gate opens. This
// endpoint exposes the PLAN/gate decision so clients can branch honestly.

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  planSession,
  SessionPlanError,
  type SessionRequest,
} from '../services/session/planner.js';
import { thinkAloudGatePassed } from '../config/env.js';
import { validateTargetUrl } from '../services/url_guard.js';

const router: RouterType = Router();

const planBody = z.object({
  source: z.enum(['user', 'campaign', 'cron']).default('user'),
  targetUrl: z.string().min(1),
  personaId: z.string().optional(),
  tier: z.enum(['T0', 'T1', 'T2']).default('T1'),
  mode: z.enum(['capture_react', 'autonomous']).default('capture_react'),
  secretAsset: z.boolean().optional(),
});

router.post('/plan', (req, res) => {
  const parsed = planBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  // The target URL is hostile input (same guard as POST /api/scan) — reject
  // private/loopback/injection hosts before it reaches any plan/capture.
  const guard = validateTargetUrl(parsed.data.targetUrl);
  if (!guard.ok) {
    res.status(400).json({ error: 'invalid_target_url', reason: guard.reason });
    return;
  }

  const reqPlan: SessionRequest = { ...parsed.data, targetUrl: guard.url };
  try {
    const plan = planSession(reqPlan, { thinkAloudGatePassed });
    res.json({ plan });
  } catch (e) {
    if (e instanceof SessionPlanError) {
      // 422: well-formed request, but a cross-axis rule (gate / sandbox)
      // forbids this combination. code lets the client branch.
      res.status(422).json({ error: e.message, code: e.code });
      return;
    }
    res.status(500).json({ error: 'plan_failed' });
  }
});

export default router;
