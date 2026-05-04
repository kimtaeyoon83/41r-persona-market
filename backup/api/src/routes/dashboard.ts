/**
 * GET /api/dashboard?role=company|tester&wallet=<addr>
 *
 * Public read-only endpoint that powers the `/` landing KPIs + primary
 * list + recent activity. Keeps the frontend a single round-trip away
 * from real data so we don't need four separate list calls on page
 * load. Wallet is optional — missing wallet returns the platform-wide
 * view (good first impression before the user connects).
 */
import { Router, type Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import { buildCompanyDashboard, buildTesterDashboard } from '../services/dashboard.js';
import { logger } from '../logger.js';

const router: ExpressRouter = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const role = String(req.query.role ?? 'company');
    const walletRaw = req.query.wallet;
    const wallet =
      typeof walletRaw === 'string' && walletRaw.length >= 32 && walletRaw.length <= 64
        ? walletRaw
        : null;

    if (role !== 'company' && role !== 'tester') {
      res.status(400).json({ error: "role must be 'company' or 'tester'" });
      return;
    }

    const payload =
      role === 'company'
        ? await buildCompanyDashboard(wallet)
        : await buildTesterDashboard(wallet);

    // Cheap cache: the data is aggregate-level and a few seconds of
    // staleness is fine for a dashboard that refreshes on navigation.
    res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=30');
    res.json(payload);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, '[GET /api/dashboard] failed');
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
